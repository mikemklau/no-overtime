// Empty shim for Node fs APIs in browser bundle
export const readFile = async () => new Uint8Array();
const emptyShim = {};
export default emptyShim;
