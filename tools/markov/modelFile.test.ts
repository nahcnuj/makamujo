import { describe, expect, it, spyOn } from "bun:test";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { MarkovChainModel } from "../../lib/MarkovChainModel";
import { emitModel, readModelJson } from "./modelFile";

const tmpDir = join(import.meta.dir, "../../var/tmp-markov-model-file-test");
const modelPath = join(tmpDir, "model.json");

/** 書き戻すテスト用のモデルを作る。 */
const modelFile = (): MarkovChainModel => {
  mkdirSync(tmpDir, { recursive: true });
  const model = new MarkovChainModel({ "": { a: 2 } });
  writeFileSync(modelPath, model.toJSON(), "utf8");
  return model;
};

describe("readModelJson", () => {
  it("reads the weights and the corpus the model writes out", () => {
    const model = modelFile();
    model.learn("あい。");
    const json = readModelJson(model);
    expect(json.model[""]?.a).toBe(2);
    expect(json.corpus).toEqual(["あい。"]);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("emitModel", () => {
  const updated = () => new MarkovChainModel({ "": { a: 1 } });

  it("prints the JSON to stdout and leaves the file alone without inPlace", () => {
    modelFile();
    const written: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      emitModel({
        modelPath,
        updated: updated(),
        inPlace: false,
        suffix: undefined,
      });
    } finally {
      write.mockRestore();
    }
    expect(JSON.parse(written.join("")).model[""].a).toBe(1);
    expect(JSON.parse(readFileSync(modelPath, "utf8")).model[""].a).toBe(2);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes the model back with inPlace", () => {
    modelFile();
    emitModel({
      modelPath,
      updated: updated(),
      inPlace: true,
      suffix: undefined,
    });
    expect(JSON.parse(readFileSync(modelPath, "utf8")).model[""].a).toBe(1);
    expect(existsSync(modelPath + ".bak")).toBe(false);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("copies the model to <modelPath><suffix> before writing back", () => {
    modelFile();
    emitModel({ modelPath, updated: updated(), inPlace: true, suffix: ".bak" });
    expect(
      JSON.parse(readFileSync(modelPath + ".bak", "utf8")).model[""].a,
    ).toBe(2);
    expect(JSON.parse(readFileSync(modelPath, "utf8")).model[""].a).toBe(1);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
