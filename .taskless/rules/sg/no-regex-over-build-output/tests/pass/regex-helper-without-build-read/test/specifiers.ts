function importSpecifiers(source: string): string[] {
  const found = [...source.matchAll(/\bfrom\s*["']([^"']+)["']/g)];
  return found.map((match) => match[1]!);
}
