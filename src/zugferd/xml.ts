const entities: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

/** Escapes text for XML element content and attribute values. */
export const escapeXml = (s: string) => s.replace(/[&<>"']/g, (c) => entities[c]!);
