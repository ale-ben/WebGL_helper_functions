export class RenderEngine {
    constructor(gl) {
        this.gl = gl;
        webglUtils.resizeCanvasToDisplaySize(this.gl.canvas);
        this.gl.viewport(0, 0, this.gl.canvas.width, this.gl.canvas.height);
        this.gl.enable(this.gl.DEPTH_TEST);
    }

    /**
     *
     * @param {*} cameraUniforms Uniforms for the camera
     * @param {*} programInfo programInfo generated from webglUtils.createProgramInfo
     * @param {*} objList Array of objects to render. Each object can have a center object and a rotation object but must have a parts array.
     */
    render(cameraUniforms, programInfo, objList) {
        objList.forEach(obj => {
            computeObjWorld(obj);
        });

        drawObjects(this.gl, objList, programInfo, cameraUniforms);
    }
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
