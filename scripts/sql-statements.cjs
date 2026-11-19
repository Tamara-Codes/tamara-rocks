// Split migration files without splitting function bodies, quoted strings or comments.
function sqlStatements(source) {
    const statements = [];
    let quote = null, dollar = null, lineComment = false, blockDepth = 0, start = 0;
    for (let i = 0; i < source.length; i++) {
        const c = source[i], next = source[i + 1];
        if (lineComment) { if (c === '\n') lineComment = false; continue; }
        if (blockDepth) { if (c === '/' && next === '*') { blockDepth++; i++; } else if (c === '*' && next === '/') { blockDepth--; i++; } continue; }
        if (dollar) { if (source.startsWith(dollar, i)) { i += dollar.length - 1; dollar = null; } continue; }
        if (quote) { if (c === quote) { if (next === quote) i++; else quote = null; } continue; }
        if (c === '-' && next === '-') { lineComment = true; i++; continue; }
        if (c === '/' && next === '*') { blockDepth = 1; i++; continue; }
        if (c === "'" || c === '"') { quote = c; continue; }
        const tag = c === '$' && source.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
        if (tag) { dollar = tag; i += tag.length - 1; continue; }
        if (c === ';') { const statement = source.slice(start, i).trim(); if (statement) statements.push(statement); start = i + 1; }
    }
    if (quote || dollar || blockDepth) throw new Error('Unterminated SQL string or comment.');
    if (source.slice(start).trim()) statements.push(source.slice(start).trim());
    return statements;
}
module.exports = { sqlStatements };
