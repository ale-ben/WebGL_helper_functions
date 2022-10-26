export class MeshLoader {

	static parseOBJ(text) {
		// Parse the OBJ file removing comments and empty lines

		// because indices are base 1 let's just fill in the 0th data
		const objPositions = [[0, 0, 0]];
		const objTexcoords = [[0, 0]];
		const objNormals = [[0, 0, 0]];
		const objColors = [[0, 0, 0]]; // There can be non standard obj formats that have v <x> <y> <z> <red> <green> <blue>

		// Object representation
		// same order as `f` indices
		const objVertexData = [
			objPositions,
			objTexcoords,
			objNormals,
			objColors,
		];

		// WebGL representation of the object
		// same order as `f` indices
		let webglVertexData = [
			[],   // positions
			[],   // texcoords
			[],   // normals
			[],   // colors
		];

		// Neede to parse mtl
		// Since each geometry must be parsed independently in order to apply right mtl, we split the object in an array of geometries
		const materialLibs = [];
		const geometries = [];
		let geometry;
		let groups = ['default']; // g keyword
		let material = 'default';
		let object = 'default'; // o keyword

		const noop = () => { }; // Used to ignore keywords

		function newGeometry() {
			// If there is an existing geometry and it's
			// not empty then start a new one.
			if (geometry && geometry.data.position.length) {
				geometry = undefined;
			}
		}

		function setGeometry() {
			if (!geometry) {
				const position = [];
				const texcoord = [];
				const normal = [];
				const color = [];
				webglVertexData = [
					position,
					texcoord,
					normal,
					color,
				];
				geometry = {
					object,
					groups,
					material,
					data: {
						position,
						texcoord,
						normal,
						color,
					},
				};
				geometries.push(geometry);
			}
		}

		function addVertex(vert) {
			const ptn = vert.split('/');
			ptn.forEach((objIndexStr, i) => {
				if (!objIndexStr) {
					return;
				}
				const objIndex = parseInt(objIndexStr);
				const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
				webglVertexData[i].push(...objVertexData[i][index]);
				// Handle non standard obj format with colors
				// if this is the position index (index 0) and we parsed
				// vertex colors then copy the vertex colors to the webgl vertex color data
				if (i === 0 && objColors.length > 1) {
					geometry.data.color.push(...objColors[index]);
				}
			});
		}

		// Keywords:
		// v: vertex position
		// vt: texture coordinate
		// vn: vertex normal
		// f: face (each element is an index in the above arrays)
		// The indices are 1 based if positive or relative to the number of vertices parsed so far if negative.
		// The order of the indices are position/texcoord/normal and that all except the position are optional
		// usemtl: material name
		// mtllib: material library (file containing the materials *.mtl)
		// o: object name
		// s: smooth shading (0 or 1)
		const keywords = {
			v(parts) {// Convert the string to a float and add it to the positions array
				// if there are more than 3 values here they are vertex colors
				if (parts.length > 3) {
					objPositions.push(parts.slice(0, 3).map(parseFloat));
					objColors.push(parts.slice(3).map(parseFloat));
				} else {
					objPositions.push(parts.map(parseFloat));
				}
			},
			vn(parts) {
				objNormals.push(parts.map(parseFloat)); // Convert the string to a float and add it to the normals array
			},
			vt(parts) {
				objTexcoords.push(parts.map(parseFloat)); // Convert the string to a float and add it to the texture coordinates array
			},
			f(parts) { // WebGL only works with triangles, we have to convert the faces to triangles
				setGeometry(); // Since usemtl is optional, we create a new geometry if we can't find one
				const numTriangles = parts.length - 2;
				for (let tri = 0; tri < numTriangles; ++tri) {
					addVertex(parts[0]);
					addVertex(parts[tri + 1]);
					addVertex(parts[tri + 2]);
				}
			},
			s: noop,    // smoothing group, TODO: Sicuro di poterlo ignorare?
			mtllib(parts, unparsedArgs) {
				// the spec says there can be multiple filenames here
				// but many exist with spaces in a single filename
				materialLibs.push(unparsedArgs);
			},
			usemtl(parts, unparsedArgs) {
				material = unparsedArgs;
				newGeometry();
			},
			g(parts) {
				groups = parts;
				newGeometry();
			}, // TODO: In verità non me ne faccio niente quindi potrebbe essere una noop?
			o(parts, unparsedArgs) {
				object = unparsedArgs;
				newGeometry();
			},
		};

		const keywordRE = /(\w*)(?: )*(.*)/; // Match a keyword at the start of a line followed by a list of arguments regexr.com/70n6l
		const lines = text.split('\n'); // Split the text into lines using \n

		for (let lineNo = 0; lineNo < lines.length; ++lineNo) { // Loop through all the lines

			const line = lines[lineNo].trim(); // Trim the line removing whitespaces at the beginning and end
			if (line === '' || line.startsWith('#')) { // Ignore empty lines and comments
				continue;
			}

			const m = keywordRE.exec(line); // Split the line into keyword and arguments using keywordRE
			if (!m) { // If the split failed, ignore the line
				continue;
			}

			const [, keyword, unparsedArgs] = m;
			const parts = line.split(/\s+/).slice(1); // Split the line using whitespaces and ignore the first element (the keyword) FIXME: Non ho capito perchè visto che ottiene lo stesso di keywordRE.exec(line)
			const handler = keywords[keyword]; // Look up the keyword in the keywords object and call the corresponding function

			if (!handler) { // If the keyword does not match any function, log a warning and continue
				console.warn('unhandled keyword:', keyword, 'at line', lineNo + 1);
				continue;
			}

			handler(parts, unparsedArgs); // Call the function with the arguments
		}

		// remove any arrays that have no entries.
		for (const geometry of geometries) {
			geometry.data = Object.fromEntries(
				Object.entries(geometry.data).filter(([, array]) => array.length > 0));
		}

		return {
			geometries,
			materialLibs,
		};
	}

	static parseMTL(text) {
		// Same logic as parseOBJ
		const materials = {};
		let material;

		// Keywords:
		// newmtl: material name
		// Ns: specular shininess exponent
		// Ka: ambient color
		// Kd: diffuse color
		// Ks: specular color
		// Ke: emissive color
		// Ni: optical density
		// d: dissolve (0.0 - 1.0)
		// illum: illumination model (Not used here so far)  
		const keywords = {
			newmtl(parts, unparsedArgs) {
				material = {};
				materials[unparsedArgs] = material;
			},
			Ns(parts) { material.shininess = parseFloat(parts[0]); },
			Ka(parts) { material.ambient = parts.map(parseFloat); },
			Kd(parts) { material.diffuse = parts.map(parseFloat); },
			Ks(parts) { material.specular = parts.map(parseFloat); },
			Ke(parts) { material.emissive = parts.map(parseFloat); },
			map_Kd(parts, unparsedArgs) { material.diffuseMap = unparsedArgs; }, // Note that according to specs unparsedArgs might have some additional args that we won't handle
			map_Ns(parts, unparsedArgs) { material.specularMap = unparsedArgs; }, // Note that according to specs unparsedArgs might have some additional args that we won't handle
			map_Bump(parts, unparsedArgs) { material.normalMap = unparsedArgs; }, // Note that according to specs unparsedArgs might have some additional args that we won't handle
			Ni(parts) { material.opticalDensity = parseFloat(parts[0]); },
			d(parts) { material.opacity = parseFloat(parts[0]); },
			illum(parts) { material.illum = parseInt(parts[0]); },
		};

		const keywordRE = /(\w*)(?: )*(.*)/;
		const lines = text.split('\n');
		for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
			const line = lines[lineNo].trim();
			if (line === '' || line.startsWith('#')) {
				continue;
			}

			const m = keywordRE.exec(line);
			if (!m) {
				continue;
			}

			const [, keyword, unparsedArgs] = m;
			const parts = line.split(/\s+/).slice(1);
			const handler = keywords[keyword];

			if (!handler) {
				console.warn('unhandled keyword:', keyword);
				continue;
			}

			handler(parts, unparsedArgs);
		}

		return materials;
	}

	static create1PixelTexture(gl, pixel) {
		const texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, texture);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
			new Uint8Array(pixel));
		return texture;
	}

	static createTexture(gl, url) {

		const isPowerOf2 = (value) => (value & (value - 1)) === 0;

		const texture = MeshLoader.create1PixelTexture(gl, [128, 192, 255, 255]);
		// Asynchronously load an image
		const image = new Image();
		image.src = url;
		image.addEventListener('load', function () {
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

	static generateTangents(position, texcoord, indices) {

		function makeIndexIterator(indices) {
			let ndx = 0;
			const fn = () => indices[ndx++];
			fn.reset = () => { ndx = 0; };
			fn.numElements = indices.length;
			return fn;
		}

		function makeUnindexedIterator(positions) {
			let ndx = 0;
			const fn = () => ndx++;
			fn.reset = () => { ndx = 0; };
			fn.numElements = positions.length / 3;
			return fn;
		}

		const subtractVector2 = (a, b) => a.map((v, ndx) => v - b[ndx]);

		const getNextIndex = indices ? makeIndexIterator(indices) : makeUnindexedIterator(position);
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
			const tangent = Number.isFinite(f)
				? m4.normalize(m4.scaleVector(m4.subtractVectors(
					m4.scaleVector(dp12, duv13[1]),
					m4.scaleVector(dp13, duv12[1]),
				), f))
				: [1, 0, 0];

			tangents.push(...tangent, ...tangent, ...tangent);
		}

		return tangents;
	}
}