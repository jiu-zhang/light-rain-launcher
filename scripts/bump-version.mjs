import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法：npm run bump -- 0.2.0");
  process.exit(1);
}

/** 只替换版本数字，保留原有格式 */
function patch(file, pattern) {
  const text = readFileSync(file, "utf8");
  if (!pattern.test(text)) {
    throw new Error("在 " + file + " 里没找到版本号字段");
  }
  writeFileSync(file, text.replace(pattern, (_match, prefix) => prefix + version));
  console.log("  ok  " + file);
}

console.log("同步版本号到 " + version + "：");
patch("package.json", /("version":\s*")\d+\.\d+\.\d+/);
patch("src-tauri/tauri.conf.json", /("version":\s*")\d+\.\d+\.\d+/);
patch("src-tauri/Cargo.toml", /(^version = ")\d+\.\d+\.\d+/m);

console.log("");
console.log("下一步：");
console.log("  git add -A");
console.log('  git commit -m "chore: release v' + version + '"');
console.log("  git tag v" + version);
console.log("  git push origin HEAD --tags");
