import pkg from "../../package.json" assert { type: "json" };

export const release = `${pkg.name}@${pkg.version}`;

export const version = pkg.version;
