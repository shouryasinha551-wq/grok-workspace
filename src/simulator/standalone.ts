import { createLab } from "./lab";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createLab(root);
