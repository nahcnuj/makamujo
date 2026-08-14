import { test, expect } from "bun:test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

test("Ansible playbook configures makamujo-audio.sh with correct PulseAudio env vars", () => {
  const playbookPath = "ansible/playbooks/0_desktop.yml";
  const playbookContent = readFileSync(playbookPath, "utf-8");

  // 1. Playbook内に makamujo-audio.sh のデプロイタスクが存在すること
  expect(playbookContent).toContain("dest: /etc/profile.d/makamujo-audio.sh");

  // 2. そのタスクの実装（content または src）から、実際のファイル中身を取得する
  const lines = playbookContent.split("\n");
  const destLineIndex = lines.findIndex(l => l.includes("dest: /etc/profile.d/makamujo-audio.sh"));
  
  let deployedContent = "";
  let usesContent = false;
  let usesSrc = false;

  // タスクのブロック内を探索
  for (let i = destLineIndex - 2; i < destLineIndex + 10; i++) {
    if (!lines[i]) continue;
    
    // content: が見つかった場合
    if (lines[i].trim().startsWith("content: |")) {
      usesContent = true;
      let j = i + 1;
      while (lines[j] && lines[j].startsWith(" ".repeat(10))) {
        deployedContent += lines[j].trimStart() + "\n";
        j++;
      }
      break;
    }
    
    // src: が見つかった場合
    if (lines[i].trim().startsWith("src: ")) {
      usesSrc = true;
      const srcMatch = lines[i].match(/src:\s*(.+)$/);
      if (srcMatch) {
        let srcPath = srcMatch[1].replace(/['"]/g, "").trim();
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
  expect(deployedContent).toContain("export PULSE_RUNTIME_PATH=/run/user/0/pulse");
});
