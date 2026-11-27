declare module 'adm-zip' {
  interface ZipEntry {
    entryName: string;
    getData(): Buffer;
  }

  class AdmZip {
    constructor(filePath?: string);
    getEntries(): ZipEntry[];
    extractAllTo(targetPath: string, overwrite?: boolean): void;
  }

  export = AdmZip;
}
