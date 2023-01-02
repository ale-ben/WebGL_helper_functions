/**
 * Class used to convert an OBJ (+ MTL file) in a WebGL mesh.
 *
 * Heavily based on https://webglfundamentals.org/webgl/lessons/webgl-load-obj.html.
 *
 * Documentation on obj files: http://paulbourke.net/dataformats/obj/
 */
export class MeshLoader {
    /**
     * Parser to convert an OBJ file in a WebGL mesh.
     *
     * Note that the parser removes automatically comments and empty lines from the file.
     * @param {string} text - The OBJ file content
     * @returns {object} - An object containing the various geometries and obj defined materials
     */
    static ParseOBJ(text) {
        // Since the internal indices start from 1 let's just fill in the 0th data
        const objPositions = [
            [0, 0, 0]
        ];
        const objTexcoords = [
            [0, 0]
        ];
        const objNormals = [
            [0, 0, 0]
        ];
        /**
         * Used to parse non standard obj formats that have `v <x> <y> <z> <red> <green> <blue>` instead of standard `v <x> <y> <z>`
         */
        const objColors = [
            [0, 0, 0]
        ];

        /**
         * Object representation of the vertex data.
         * The elements have the same order as the `f` indices.
         */
        const objVertexData = [objPositions, objTexcoords, objNormals, objColors];

        /**
         * WebGL representation of the vertex data.
         * The elements have the same order as the `f` indices.
         *
         * This will be used as a cache to avoid duplicating vertices while constructing geometries.
         */
        let webglVertexData = [
            [], // positions
            [], // texcoords
            [], // normals
            [], // colors
        ];

        /**
         * Keep track of the material file names (MTL files) found in the obj file in order to try to load them later from the mtl (or from a definition in the obj file).
         */
        const materialLibs = [];

        /**
         * Since each geometry must be parsed independently in order to apply right material, we will split the object in an array of geometries
         */
        const geometries = [];

        /**
         * The current geometry being parsed
         */
        let geometry;

        let groups = ["default"]; // g keyword
        let material = "default";
        let object = "default"; // o keyword

        /**
         * No Operation function used to skip some keywords.
         */
        const noop = () => {};

        /**
         * Generate a new geometry if the current geometry has already been used.
         */
        function newGeometry() {
            if (geometry && geometry.data.position.length) {
                geometry = undefined;
            }
        }

        /**
         * Prepare the current geometry to receive vertex data and add it to the geometry list.
         */
        function setGeometry() {
            if (!geometry) {
                const position = [];
                const texcoord = [];
                const normal = [];
                const color = [];
                webglVertexData = [position, texcoord, normal, color];
                geometry = {
                    object,
                    groups,
                    material,
                    data: {
                        position,
                        texcoord,
                        normal,
                        color
                    }
                };
                geometries.push(geometry);
            }
        }

        /**
         * Add a vertex tuple extracted from `f` line to the current geometry.
         *
         * @param {string} vert Vertex tuple to add to the geometry in the form of `v1/vt1/vn1`
         */
        function addVertex(vert) {
            // Split the vertex tuple in v, vt, and vn
            const ptn = vert.split("/");
            ptn.forEach((objIndexStr, i) => {
                if (!objIndexStr) {
                    return;
                }
                // Convert the index from string to integer
                const objIndex = parseInt(objIndexStr);
                // An index of -n represented the vertex n lines above the current line
                const index = objIndex + (
                    objIndex >= 0 ?
                    0 :
                    objVertexData[i].length);
                // Add the vertex data to the WebGL representation
                webglVertexData[i].push(...objVertexData[i][index]);
                // Handle non standard obj format with colors
                // if this is the position index (index 0) and we parsed
                // vertex colors then copy the vertex colors to the webgl vertex color data
                if (i === 0 && objColors.length > 1) {
                    geometry.data.color.push(...objColors[index]);
                }
            });
        }

        /**
         * Switches between the different keywords in the obj file.
         *
         * - v: vertex position
         * - vt: texture coordinate
         * - vn: vertex normal
         * - f: face (each element is an index in the above arrays)
         *   - The indices are 1 based if positive or relative to the number of vertices parsed so far if negative.
         *   - The order of the indices are position/texcoord/normal and that all except the position are optional
         * - usemtl: material name
         * - mtllib: material library (file containing the materials *.mtl)
         * - o: object name
         * - s: smooth shading (0 or 1)
         */
        const keywords = {
            v(parts) {
                // Convert the string to a float and add it to the positions array
                // if there are more than 3 values here they are vertex colors
                if (parts.length > 3) {
                    objPositions.push(parts.slice(0, 3).map(parseFloat));
                    objColors.push(parts.slice(3).map(parseFloat));
                } else {
                    objPositions.push(parts.map(parseFloat));
                }
            },
            vn(parts) {
                // Convert the string to a float and add it to the normals array
                objNormals.push(parts.map(parseFloat));
            },
            vt(parts) {
                // Convert the string to a float and add it to the texture coordinates array
                objTexcoords.push(parts.map(parseFloat));
            },
            f(parts) {
                // Initialize a new geometry, just to be sure (Should be initialized by usemtl but it is optional)
                setGeometry();

                // WebGL only works with triangles, we have to convert the faces to triangles
                const numTriangles = parts.length - 2;
                for (let tri = 0; tri < numTriangles; ++tri) {
                    addVertex(parts[0]);
                    addVertex(parts[tri + 1]);
                    addVertex(parts[tri + 2]);
                }
            },
            s: noop, // smoothing group, ignored
            mtllib(parts, unparsedArgs) {
                // The spec says there can be multiple mtl files in an obj file
                materialLibs.push(unparsedArgs);
            },
            usemtl(parts, unparsedArgs) {
                // Specify the material that should be used for the following faces and initialize a new geometry
                material = unparsedArgs;
                newGeometry();
            },
            g(parts) {
                // Start a new group
                groups = parts;
                newGeometry();
            },
            o(parts, unparsedArgs) {
                // Start a new object
                object = unparsedArgs;
                newGeometry();
            }
        };

        // Parse each line of the obj file and call the appropriate function
        parseLines(text, keywords);

        // remove any arrays that have no entries in order to optimize the geomtery (and future renderigns).
        for (const geometry of geometries) {
            geometry.data = Object.fromEntries(Object.entries(geometry.data).filter(([, array]) => array.length > 0));
        }

        return {
            geometries,
            materialLibs
        };
    }

    /**
     * Parser to load the materials for a WebGL mesh.
     *
     * Works using the same logic as the obj parser.
     * @param {string} text - The MTL file content
     * @returns {object} - The materials definitions
     */
    static ParseMTL(text) {
        /**
         * Object containing all the materials with the material name as a keyword
         */
        const materials = {};

        /**
         * The current material
         */
        let material;

        /**
         * Switches between the different keywords in the mtl file.
         *
         * - newmtl: material name
         * - Ns: specular shininess exponent
         * - Ka: ambient color
         * - Kd: diffuse color
         * - Ks: specular color
         * - Ke: emissive color
         * - Ni: optical density
         * - d: dissolve (0.0 - 1.0)
         * - illum: illumination model (Not used here so far)
         */
        const keywords = {
            newmtl(parts, unparsedArgs) {
                material = {};
                materials[unparsedArgs] = material;
            },
            Ns(parts) {
                material.shininess = parseFloat(parts[0]);
            },
            Ka(parts) {
                material.ambient = parts.map(parseFloat);
            },
            Kd(parts) {
                material.diffuse = parts.map(parseFloat);
            },
            Ks(parts) {
                material.specular = parts.map(parseFloat);
            },
            Ke(parts) {
                material.emissive = parts.map(parseFloat);
            },
            map_Kd(parts, unparsedArgs) {
                material.diffuseMap = unparsedArgs;
            }, // Note that according to specs unparsedArgs might have some additional args that we won't handle
            map_Ns(parts, unparsedArgs) {
                material.specularMap = unparsedArgs;
            }, // Note that according to specs unparsedArgs might have some additional args that we won't handle
            map_Bump(parts, unparsedArgs) {
                material.normalMap = unparsedArgs;
            }, // Note that according to specs unparsedArgs might have some additional args that we won't handle
            Ni(parts) {
                material.opticalDensity = parseFloat(parts[0]);
            },
            d(parts) {
                material.opacity = parseFloat(parts[0]);
            },
            illum(parts) {
                material.illum = parseInt(parts[0]);
            }
        };

        // Parse each line of the mtl file and call the appropriate function
        parseLines(text, keywords);

        return materials;
    }

    /**
     * Load an obj and mesh in the passed object.
     * The passed object MUST contain the following properties:
     * - name: name of the object
     * - filePath: path to the obj file
     *
     * @param {*} gl
     * @param {*} object
     */
    static async LoadOBJAndMesh(gl, object) {
        if (debug && debug == true)
            console.log("Loading mesh " + object.name + " from " + object.filePath + (
                object.mtlPath ?
                " with MTL file " + object.mtlPath :
                ""));

        // Load OBJ file
        const objResponse = await fetch(object.filePath);
        const objText = await objResponse.text();
        const obj = this.ParseOBJ(objText);

        // Load MTL file
        const baseHref = new URL(object.filePath, window.location.href);
        let materials;
        if (!object.mtlPath) {
            const matTexts = await Promise.all(obj.materialLibs.map(async filename => {
                const matHref = new URL(filename, baseHref).href;
                const response = await fetch(matHref);
                return await response.text();
            }));
            materials = this.ParseMTL(matTexts.join("\n"));
        } else {
            if (debug && debug == true)
                console.log("Loading manually defined MTL file " + object.mtlPath);
            const mtlResponse = await fetch(object.mtlPath);
            const mtlText = await mtlResponse.text();
            materials = this.ParseMTL(mtlText);
        }

        const textures = {
            defaultWhite: create1PixelTexture(gl, [255, 255, 255, 255]),
            defaultNormal: create1PixelTexture(gl, [127, 127, 255, 0])
        };

        const defaultMaterial = {
            diffuse: [
                1, 1, 1
            ],
            diffuseMap: textures.defaultWhite,
            normalMap: textures.defaultNormal,
            ambient: [
                0, 0, 0
            ],
            specular: [
                1, 1, 1
            ],
            specularMap: textures.defaultWhite,
            shininess: 400,
            opacity: 1
        };

        // load texture for materials
        for (const material of Object.values(materials)) {
            Object.entries(material).filter(([key]) => key.endsWith("Map")).forEach(([key, filename]) => {
                let texture = textures[filename];
                if (!texture) {
                    const textureHref = new URL(filename, baseHref).href;
                    texture = createTexture(gl, textureHref);
                    textures[filename] = texture;
                }
                material[key] = texture;
            });
        }

        object.parts = obj.geometries.map(({
            material,
            data
        }) => {
            // Since each geometry has it's own buffer, we have to load them separately
            // Because data is just named arrays like this
            //
            // {
            //   position: [...],
            //   texcoord: [...],
            //   normal: [...],
            // }
            //
            // and because those names match the attributes in our vertex
            // shader we can pass it directly into `createBufferInfoFromArrays`
            // from the article "less code more fun".

            if (data.color) {
                if (data.position.length === data.color.length) {
                    // it's 3. The our helper library assumes 4 so we need
                    // to tell it there are only 3.
                    data.color = {
                        numComponents: 3,
                        data: data.color
                    };
                }
            } else {
                // there are no vertex colors so just use constant white
                data.color = {
                    value: [1, 1, 1, 1]
                };
            }

            // generate tangents if we have the data to do so.
            if (data.texcoord && data.normal) {
                data.tangent = generateTangents(data.position, data.texcoord);
            } else {
                // There are no tangents
                data.tangent = {
                    value: [1, 0, 0]
                };
            }

            if (!data.texcoord) {
                data.texcoord = {
                    value: [0, 0]
                };
            }

            if (!data.normal) {
                // we probably want to generate normals if there are none
                data.normal = {
                    value: [0, 0, 1]
                };
            }

            // create a buffer for each array by calling
            // gl.createBuffer, gl.bindBuffer, gl.bufferData
            const bufferInfo = webglUtils.createBufferInfoFromArrays(gl, data);
            return {
                material: {
                    ...defaultMaterial,
                    ...materials[material]
                },
                bufferInfo
            };
        });

        if (debug && debug == true)
            console.log("Loaded mesh for " + object.name + ". ", object);
    }
}

/**
 * Create and binf a base texture
 * @param {*} gl The webgl environment
 * @param {*} pixel Array with color values
 * @returns
 */
function create1PixelTexture(gl, pixel) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(pixel));
    return texture;
}

/**
 * Create a texture from an image
 * @param {*} gl The webgl environment
 * @param {*} url Address of the image
 * @returns
 */
function createTexture(gl, url) {
    const isPowerOf2 = value => (value & (value - 1)) === 0;

    const texture = create1PixelTexture(gl, [128, 192, 255, 255]);
    // Asynchronously load an image
    const image = new Image();
    image.src = url;
    image.addEventListener("load", function() {
        // Now that the image has loaded make copy it to the texture.
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);

        // Check if the image is a power of 2 in both dimensions.
        if (isPowerOf2(image.width) && isPowerOf2(image.height)) {
            // Yes, it's a power of 2. Generate mips.
            gl.generateMipmap(gl.TEXTURE_2D);
        } else {
            // No, it's not a power of 2. Turn of mips and set wrapping to clamp to edge
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        }
    });
    return texture;
}

function generateTangents(position, texcoord, indices) {
    function makeIndexIterator(indices) {
        let ndx = 0;
        const fn = () => indices[ndx++];
        fn.reset = () => {
            ndx = 0;
        };
        fn.numElements = indices.length;
        return fn;
    }

    function makeUnindexedIterator(positions) {
        let ndx = 0;
        const fn = () => ndx++;
        fn.reset = () => {
            ndx = 0;
        };
        fn.numElements = positions.length / 3;
        return fn;
    }

    const subtractVector2 = (a, b) => a.map((v, ndx) => v - b[ndx]);

    const getNextIndex = indices ?
        makeIndexIterator(indices) :
        makeUnindexedIterator(position);
    const numFaceVerts = getNextIndex.numElements;
    const numFaces = numFaceVerts / 3;

    const tangents = [];
    for (let i = 0; i < numFaces; ++i) {
        const n1 = getNextIndex();
        const n2 = getNextIndex();
        const n3 = getNextIndex();

        const p1 = position.slice(n1 * 3, n1 * 3 + 3);
        const p2 = position.slice(n2 * 3, n2 * 3 + 3);
        const p3 = position.slice(n3 * 3, n3 * 3 + 3);

        const uv1 = texcoord.slice(n1 * 2, n1 * 2 + 2);
        const uv2 = texcoord.slice(n2 * 2, n2 * 2 + 2);
        const uv3 = texcoord.slice(n3 * 2, n3 * 2 + 2);

        const dp12 = m4.subtractVectors(p2, p1);
        const dp13 = m4.subtractVectors(p3, p1);

        const duv12 = subtractVector2(uv2, uv1);
        const duv13 = subtractVector2(uv3, uv1);

        const f = 1.0 / (duv12[0] * duv13[1] - duv13[0] * duv12[1]);
        const tangent = Number.isFinite(f) ?
            m4.normalize(m4.scaleVector(m4.subtractVectors(m4.scaleVector(dp12, duv13[1]), m4.scaleVector(dp13, duv12[1])), f)) :
            [1, 0, 0];

        tangents.push(...tangent, ...tangent, ...tangent);
    }

    return tangents;
}

/**
 * Private function to parse line by line an obj or mtl file
 * @param {string} text Content of the obj or mtl file
 * @param {*} keywords Object with the keywords to parse
 */
function parseLines(text, keywords) {
    /**
     * Match a keyword at the start of a line followed by a list of arguments https://regexr.com/70n6l
     */
    const keywordRE = /(\w*)(?: )*(.*)/;
    const lines = text.split("\n"); // Split the text into lines using \n

    // Loop through all the lines splitted above
    for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
        const line = lines[lineNo].trim(); // Trim the line removing whitespaces at the beginning and end

        // Ignore empty lines and comments
        if (line === "" || line.startsWith("#")) {
            continue;
        }

        const m = keywordRE.exec(line); // Split the line into keyword and arguments using keywordRE
        // If the split failed, ignore the line and continue
        if (!m) {
            continue;
        }
        const [, keyword, unparsedArgs] = m;

        const parts = line.split(/\s+/).slice(1); // Split the line on whitespaces and ignore the first element (the keyword)
        const handler = keywords[keyword]; // Look up the keyword in the keywords object and call the corresponding function

        // If the keyword does not match any function, log a warning and continue
        if (!handler) {
            console.warn("unhandled keyword:", keyword, "at line", lineNo + 1);
            continue;
        }

        handler(parts, unparsedArgs); // Call the function with the required arguments
    }
}
