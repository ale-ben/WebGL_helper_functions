export class RenderEngine {
    /**
     *
     * @param {*} gl
     * @param {*} options Dictionary of options.
     * @param {boolean} options.enablePicker If true, the render engine will render to a texture and detect objects by their color.
     * @param {boolean} options.enableTransparency If true, the render engine will enable alpha blending.
     */
    constructor(gl, options = {}) {
        this.gl = gl;

        this.enablePicker = options.enablePicker || false;
        this.enableTransparency = options.enableTransparency || false;

        gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);

        if (this.enableTransparency) {
            gl.enable(gl.BLEND); // enable alpha blending
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        }

        webglUtils.resizeCanvasToDisplaySize(gl.canvas);

        if (this.enablePicker) {
            // Create a texture to render to
            this.targetTexture = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, this.targetTexture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            // create a depth renderbuffer
            this.depthBuffer = gl.createRenderbuffer();
            gl.bindRenderbuffer(gl.RENDERBUFFER, this.depthBuffer);

            // Create and bind the framebuffer
            this.fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, this.fb);

            // attach the texture as the first color attachment
            const attachmentPoint = gl.COLOR_ATTACHMENT0;
            const level = 0;
            gl.framebufferTexture2D(gl.FRAMEBUFFER, attachmentPoint, gl.TEXTURE_2D, this.targetTexture, level);

            // make a depth buffer and the same size as the targetTexture
            gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depthBuffer);

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);

            setFramebufferAttachmentSizes(gl, this.targetTexture, this.depthBuffer);
        }
    }

    /**
     *
     * @param {*} cameraUniforms Uniforms for the camera
     * @param {*} programInfo programInfo generated from webglUtils.createProgramInfo
     * @param {*} objList Array of objects to render. Each object can have a center object and a rotation object but must have a parts array.
     */
    render(cameraUniforms, programInfo, objList, pickerProgramInfo) {
        if (this.enablePicker && webglUtils.resizeCanvasToDisplaySize(this.gl.canvas)) {
            // the canvas was resized, make the framebuffer attachments match
            setFramebufferAttachmentSizes(this.gl, this.targetTexture, this.depthBuffer);
        }

        objList.forEach(obj => {
            computeObjWorld(obj);
        });

        if (this.enablePicker) {
            // ------ Draw the object id to the picker texture --------

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fb);
            this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

            this.gl.enable(this.gl.CULL_FACE);
            this.gl.enable(this.gl.DEPTH_TEST);
            this.gl.disable(this.gl.BLEND);

            // Clear the canvas AND the depth buffer.
            this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);

            drawObjects(this.gl, objList, pickerProgramInfo, cameraUniforms);

            // ------ Draw the objects to the canvas

            this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
            this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
            this.gl.enable(this.gl.BLEND);
        }

        // ----- Draw the objects to the "real" canvas
        drawObjects(this.gl, objList, programInfo, cameraUniforms);
    }

    /**
     * If enablePicker is true, the render engine will generate a secondary frameBuffer to render the ids of the objects.
     * Each object will have a texture with the id represented as color.
     * This function will return the id of the object that is under the mouse.
     * @param {*} mouseX The x coordinate of the mouse in the canvas
     * @param {*} mouseY The y coordinate of the mouse in the canvas
     * @returns
     */
    detectObject(mouseX, mouseY) {
        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fb);

        const pixelX = (mouseX * this.gl.canvas.width) / this.gl.canvas.clientWidth;
        const pixelY = this.gl.canvas.height - (mouseY * this.gl.canvas.height) / this.gl.canvas.clientHeight - 1;
        const data = new Uint8Array(4);
        this.gl.readPixels(pixelX, // x
            pixelY, // y
            1, // width
            1, // height
            this.gl.RGBA, // format
            this.gl.UNSIGNED_BYTE, // type
            data); // typed array to hold result
        const id = data[0] + (data[1] << 8) + (data[2] << 16) + (data[3] << 24);

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        return id;
    }

    // Picker shaders
    static pickerShaders = {
        vs: `
		attribute vec4 a_position;
	
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_world;
		uniform vec3 u_viewWorldPosition;
	
		void main() {
			// Multiply the position by the matrices
			vec4 worldPosition = u_world * a_position;
			gl_Position = u_projection * u_view * worldPosition;
		}
		`,
        fs: `
		precision mediump float;
		uniform vec4 u_id;
	
		void main() {
			gl_FragColor = u_id;
		}
		`
    };

    // Default shaders
    static defaultShaders = {
        vs: `
		attribute vec4 a_position;
		attribute vec3 a_normal;
		attribute vec3 a_tangent;
		attribute vec2 a_texcoord;
		attribute vec4 a_color;
	  
		uniform mat4 u_projection;
		uniform mat4 u_view;
		uniform mat4 u_world;
		uniform vec3 u_viewWorldPosition;
	  
		varying vec3 v_normal;
		varying vec3 v_tangent;
		varying vec3 v_surfaceToView;
		varying vec2 v_texcoord;
		varying vec4 v_color;
	  
		void main() {
		  vec4 worldPosition = u_world * a_position;
		  gl_Position = u_projection * u_view * worldPosition;
		  v_surfaceToView = u_viewWorldPosition - worldPosition.xyz;
		  mat3 normalMat = mat3(u_world);
		  v_normal = normalize(normalMat * a_normal);
		  v_tangent = normalize(normalMat * a_tangent);
	  
		  v_texcoord = a_texcoord;
		  v_color = a_color;
		}
		`,
        fs: `
		precision highp float;
	  
		varying vec3 v_normal;
		varying vec3 v_tangent;
		varying vec3 v_surfaceToView;
		varying vec2 v_texcoord;
		varying vec4 v_color;
	  
		uniform vec3 diffuse;
		uniform sampler2D diffuseMap;
		uniform vec3 ambient;
		uniform vec3 emissive;
		uniform vec3 specular;
		uniform sampler2D specularMap;
		uniform float shininess;
		uniform sampler2D normalMap;
		uniform float opacity;
		uniform vec3 u_lightDirection;
		uniform vec3 u_ambientLight;
	  
		void main () {
		  vec3 normal = normalize(v_normal) * ( float( gl_FrontFacing ) * 2.0 - 1.0 );
		  vec3 tangent = normalize(v_tangent) * ( float( gl_FrontFacing ) * 2.0 - 1.0 );
		  vec3 bitangent = normalize(cross(normal, tangent));
	  
		  mat3 tbn = mat3(tangent, bitangent, normal);
		  normal = texture2D(normalMap, v_texcoord).rgb * 2. - 1.;
		  normal = normalize(tbn * normal);
	  
		  vec3 surfaceToViewDirection = normalize(v_surfaceToView);
		  vec3 halfVector = normalize(u_lightDirection + surfaceToViewDirection);
	  
		  float fakeLight = dot(u_lightDirection, normal) * .5 + .5;
		  float specularLight = clamp(dot(normal, halfVector), 0.0, 1.0);
		  vec4 specularMapColor = texture2D(specularMap, v_texcoord);
		  vec3 effectiveSpecular = specular * specularMapColor.rgb;
	  
		  vec4 diffuseMapColor = texture2D(diffuseMap, v_texcoord);
		  vec3 effectiveDiffuse = diffuse * diffuseMapColor.rgb * v_color.rgb;
		  float effectiveOpacity = opacity * diffuseMapColor.a * v_color.a;
	  
		  gl_FragColor = vec4(
			  emissive +
			  ambient * u_ambientLight +
			  effectiveDiffuse * fakeLight +
			  effectiveSpecular * pow(specularLight, shininess),
			  effectiveOpacity);
		}
		`
    };
}

function setFramebufferAttachmentSizes(gl, targetTexture, depthBuffer) {
    gl.bindTexture(gl.TEXTURE_2D, targetTexture);
    // define size and format of level 0
    const level = 0;
    const internalFormat = gl.RGBA;
    const border = 0;
    const format = gl.RGBA;
    const type = gl.UNSIGNED_BYTE;
    const data = null;
    gl.texImage2D(gl.TEXTURE_2D, level, internalFormat, gl.canvas.width, gl.canvas.height, border, format, type, data);

    gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, gl.canvas.width, gl.canvas.height);
}

/**
 * This function will compute the world matrix of an object.
 * @param {*} obj The object to compute the world matrix
 */
function computeObjWorld(obj) {
    let u_world = m4.identity();

    // Handle object translation

    if (obj.rotation.onAxes && (obj.rotation.onAxes.x != 0 || obj.rotation.onAxes.y != 0 || obj.rotation.onAxes.z != 0)) {
        if (obj.rotation.onAxes.x != 0) {
            u_world = m4.xRotate(u_world, obj.rotation.onAxes.x);
        }
        if (obj.rotation.onAxes.y != 0) {
            u_world = m4.yRotate(u_world, obj.rotation.onAxes.y);
        }
        if (obj.rotation.onAxes.z != 0) {
            u_world = m4.zRotate(u_world, obj.rotation.onAxes.z);
        }
    }

    // Handle object translation
    if (obj.center && (obj.center.x != 0 || obj.center.y != 0 || obj.center.z != 0)) {
        u_world = m4.translate(u_world, obj.center.x, obj.center.y, obj.center.z);
    }

    if (obj.rotation.onSelf && (obj.rotation.onSelf.x != 0 || obj.rotation.onSelf.y != 0 || obj.rotation.onSelf.z != 0)) {
        if (obj.rotation.onSelf.x != 0) {
            u_world = m4.xRotate(u_world, obj.rotation.onSelf.x);
        }
        if (obj.rotation.onSelf.y != 0) {
            u_world = m4.yRotate(u_world, obj.rotation.onSelf.y);
        }
        if (obj.rotation.onSelf.z != 0) {
            u_world = m4.zRotate(u_world, obj.rotation.onSelf.z);
        }
    }

    obj.uniforms.u_world = u_world;
}

/**
 * This function will draw the objects in the list.
 * It will use the programInfo to set the uniforms and attributes.
 * @param {*} gl WebGL context
 * @param {*} objectsToDraw List of objects to draw
 * @param {*} programInfo The programInfo to use to set the uniforms and attributes
 * @param {*} cameraUniforms The uniforms to set for the camera
 */
function drawObjects(gl, objectsToDraw, programInfo, cameraUniforms) {
    gl.useProgram(programInfo.program);
    webglUtils.setUniforms(programInfo, cameraUniforms); // Can I move this inside object uniforms?

    objectsToDraw.forEach(obj => {
        if (!obj.hidden && obj.parts) {
            for (const {
                    bufferInfo,
                    material
                } of obj.parts) {
                // calls gl.bindBuffer, gl.enableVertexAttribArray, gl.vertexAttribPointer
                webglUtils.setBuffersAndAttributes(gl, programInfo, bufferInfo);

                webglUtils.setUniforms(programInfo, obj.uniforms, material);

                // calls gl.drawArrays or gl.drawElements
                webglUtils.drawBufferInfo(gl, bufferInfo);
            }
        }
    });
}
