export class RenderEngine {
    constructor(gl) {
        this.gl = gl;
		gl.enable(gl.CULL_FACE);
        gl.enable(gl.DEPTH_TEST);

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

    /**
     *
     * @param {*} cameraUniforms Uniforms for the camera
     * @param {*} programInfo programInfo generated from webglUtils.createProgramInfo
     * @param {*} objList Array of objects to render. Each object can have a center object and a rotation object but must have a parts array.
     */
    render(cameraUniforms, programInfo, objList, pickerProgramInfo) {

		if (webglUtils.resizeCanvasToDisplaySize(this.gl.canvas)) {
            // the canvas was resized, make the framebuffer attachments match
            setFramebufferAttachmentSizes(this.gl, this.targetTexture, this.depthBuffer);
        }

        objList.forEach(obj => {
            computeObjWorld(obj);
        });

		// ------ Draw the objects to the texture --------

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, this.fb);
        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

        this.gl.enable(this.gl.CULL_FACE);
        this.gl.enable(this.gl.DEPTH_TEST);

        // Clear the canvas AND the depth buffer.
        this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);


        drawObjects(this.gl, objList, pickerProgramInfo, cameraUniforms);

        // ------ Draw the objects to the canvas

        this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);

        drawObjects(this.gl, objList, programInfo, cameraUniforms);
    }

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

function computeObjWorld(obj) {
    let u_world = m4.identity();

    // Handle object translation
    if (obj.center && (obj.center.x != 0 || obj.center.y != 0 || obj.center.z != 0)) {
        u_world = m4.translate(u_world, obj.center.x, obj.center.y, obj.center.z);
    }

    // Handle object rotation
    //u_world = m4.xRotate(u_world, time);
    //u_world = m4.yRotate(u_world, time);
    //u_world = m4.zRotate(u_world, time);

    if (obj.rotation) {
        if (obj.rotation.x != 0) {
            u_world = m4.xRotate(u_world, obj.rotation.x);
        }
        if (obj.rotation.y != 0) {
            u_world = m4.yRotate(u_world, obj.rotation.y);
        }
        if (obj.rotation.z != 0) {
            u_world = m4.zRotate(u_world, obj.rotation.z);
        }
    }

    obj.uniforms.u_world = u_world;
}

function drawObjects(gl, objectsToDraw, programInfo, cameraUniforms) {
    gl.useProgram(programInfo.program);
    webglUtils.setUniforms(programInfo, cameraUniforms);

    objectsToDraw.forEach(obj => {
        for (const {
                bufferInfo,
                material
            } of obj.parts) {
            // calls gl.bindBuffer, gl.enableVertexAttribArray, gl.vertexAttribPointer
            webglUtils.setBuffersAndAttributes(gl, programInfo, bufferInfo);

            // calls gl.uniform
            webglUtils.setUniforms(programInfo, obj.uniforms, material);

            // calls gl.drawArrays or gl.drawElements
            webglUtils.drawBufferInfo(gl, bufferInfo);
        }
    });
}
