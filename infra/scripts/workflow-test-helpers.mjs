// Returns the script text of every `run:` step, so tests can assert what reaches
// the shell without matching unrelated `env:` blocks.
export function runBlocks(workflow) {
  const lines = workflow.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:- )?run:(.*)$/);
    if (!match) continue;
    const indent = match[1].length;
    const block = [match[2]];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() !== '' && line.search(/\S/) <= indent) break;
      block.push(line);
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}
