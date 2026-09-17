import pkg from "../../package.json" with { type: "json" };

export const release = `${pkg.name}@${pkg.version}`;

export const userAgent = `${pkg.name}/${pkg.version} (${pkg.homepage})`;

export const version = pkg.version;
