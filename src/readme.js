/**
 * @param {string} name 
 * @param {string} api_version 
 * @param {string} package_version 
 */
 export function createREADME(name, api_version, package_version) {
    return `# ${name} ${api_version}

TypeScript definitions for ${name}. Generated from version ${package_version}.

Generated with [gi.ts](https://gitlab.gnome.org/ewlsh/gi.ts) and tracked in the [gi-ts Organization on GitHub](https://github.com/gi-ts).
`
};