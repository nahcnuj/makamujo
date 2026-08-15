import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

test("Ansible playbook configures makamujo-audio.sh with correct PulseAudio env vars", () => {
  const playbookPath = "ansible/playbooks/0_desktop.yml";
  const playbookContent = readFileSync(playbookPath, "utf-8");

  // 1. Playbook内に makamujo-audio.sh のデプロイタスクが存在すること
  expect(playbookContent).toContain("dest: /etc/profile.d/makamujo-audio.sh");

  // 2. そのタスクの実装（content または src）から、実際のファイル中身を取得する
  const lines = playbookContent.split("\n");
  const destLineIndex = lines.findIndex((line) =>
    line.includes("dest: /etc/profile.d/makamujo-audio.sh"),
  );
  expect(destLineIndex).toBeGreaterThanOrEqual(0);

  let deployedContent = "";
  let usesContent = false;
  let usesSrc = false;

  // タスクのブロック内を探索
  const searchStart = Math.max(0, destLineIndex - 2);
  const searchEnd = Math.min(lines.length, destLineIndex + 10);
  for (let i = searchStart; i < searchEnd; i++) {
    const line = lines[i];
    if (line === undefined) continue;

    // content: が見つかった場合
    if (line.trim().startsWith("content: |")) {
      usesContent = true;
      let j = i + 1;
      while (j < lines.length) {
        const contentLine = lines[j];
        if (
          contentLine === undefined ||
          !contentLine.startsWith(" ".repeat(10))
        ) {
          break;
        }
        deployedContent += contentLine.trimStart() + "\n";
        j++;
      }
      break;
    }

    // src: が見つかった場合
    if (line.trim().startsWith("src: ")) {
      usesSrc = true;
      const srcMatch = line.match(/src:\s*(.+)$/);
      const rawSrc = srcMatch?.[1];
      if (rawSrc !== undefined) {
        let srcPath = rawSrc.replace(/['"]/g, "").trim();
        // {{ playbook_dir }} を実際のパスに置換
        if (srcPath.includes("{{ playbook_dir }}")) {
          srcPath = srcPath.replace("{{ playbook_dir }}", "ansible/playbooks");
        }
        expect(existsSync(srcPath)).toBe(true);
        deployedContent = readFileSync(srcPath, "utf-8");
      }
      break;
    }
  }

  expect(usesContent || usesSrc).toBe(true);

  // 3. 展開されるファイルの中身に、必要な2つの環境変数が含まれていること
  expect(deployedContent).toContain("export XDG_RUNTIME_DIR=/run/user/0");
  expect(deployedContent).toContain(
    "export PULSE_RUNTIME_PATH=/run/user/0/pulse",
  );
});
