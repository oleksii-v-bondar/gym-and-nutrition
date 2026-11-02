export async function readPlanFile(file: File): Promise<unknown> {
  const text = await file.text();
  return JSON.parse(text);
}
