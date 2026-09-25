/**
 * Qubibyte Graphics 3D engine: geometry, cameras, lights, materials, a
 * Scene3D node that projects to depth-ordered 2D paths, 3D animations,
 * quantum building blocks, mesh import and export, and a WebGL2 preview.
 * @module three
 */

export * as vec3 from './vec3.js';
export * as mat4 from './mat4.js';
export * as quat from './quat.js';

export { Camera3D } from './camera.js';
export { Scene3D } from './scene3d.js';
export {
  Object3D, Group3D, Mesh3D, Surface3D, ImagePlane3D, Lines3D, Points3D, Label3D, Arrow3D, text3D,
  clipMesh, explodeMesh, unfoldMesh, netTree, resampleRadial, lerpMesh, hull2D, scene3dOf,
} from './object3d.js';
export { Axes3D, sphericalGrid, cylindricalGrid, planeGrid, streamline } from './axes3d.js';

export {
  makeMesh, vertexCount, faceNormals, faceCentroids, meshEdges, isClosed, eulerCharacteristic, meshBounds, meshVolume, meshArea,
  newell, weld, flipFaces, orientOutward, transformMesh, translateMesh, mergeMeshes, triangulateMesh, convexHull,
  POLYHEDRA, polyhedron, gridMesh, box, roundedBox, uvSphere, icosphere, cubeSphere, cubeGrid, cylinder, cone, prism, torus,
  torusKnot, plane, parametricSurface, heightField, ruledSurface, lathe, transportFrames, tube, loft, extrudePath,
  groupContours, levelSets,
} from './geometry.js';
export { triangulatePolygon } from './triangulate.js';
export { marchingCubes, MC_TRI_TABLE, MC_EDGE_TABLE, MC_CORNERS, MC_EDGES } from './marching.js';

export { MATERIALS, SHADING, material, presetMaterial, shade, softenColor, AlphaColor } from './materials.js';
export {
  LIGHT_PRESETS, WRAP, directionalLight, pointLight, ambientLight, hemisphereLight, resolveLightPreset, worldLights,
  diffuseAt, specularAt,
} from './lighting.js';

export { POLY, SEG, PT, planeOf, eyeSide, splitPrim, orderScene, orderByGraph } from './order.js';
export { renderUnits, fillResolver, loadLabelText } from './render.js';

export {
  Rotate3D, rotate3D, MeshMorph, morphMesh, matchMeshes, SurfaceSweep, surfaceSweep, Unfold, unfold, Explode, explode,
  CrossSection, crossSection, OrbitCamera, orbitCamera, FlyThrough, flyThrough, CameraTo, cameraTo, Create3D, create3D,
} from './animations3d.js';

export {
  BlochSphere, blochSphere, BlochRotate, blochRotate, BLOCH_LABELS, qSphere, barCity, amplitudeLandscape, circuitMesh,
} from './quantum3d.js';

export { parseOBJ, parseSTL, parseGLTF, parse3MF, parse3MFModel, importMesh } from './import.js';
export { exportSTLBinary, exportSTLAscii, exportOBJ, export3MF, model3MF } from './export.js';
export { readZip, writeZip, crc32, inflateRaw } from './zip.js';

export { WebGLPreview, VERTEX_SHADER, FRAGMENT_SHADER, meshBuffers, lightUniforms, previewState } from './webgl.js';
