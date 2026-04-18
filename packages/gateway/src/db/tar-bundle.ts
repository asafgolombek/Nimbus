import { create as tarCreate, extract as tarExtract } from "tar";

export async function packBundle(sourceDir: string, outputTarGzPath: string): Promise<void> {
  await tarCreate({ gzip: true, file: outputTarGzPath, cwd: sourceDir }, ["."]);
}

export async function unpackBundle(tarGzPath: string, destDir: string): Promise<void> {
  await tarExtract({ file: tarGzPath, cwd: destDir });
}
