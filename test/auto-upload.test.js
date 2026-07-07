const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { scanWorkFiles } = require("../auto-upload/files");
const { buildUploadPlan, matchCategory, matchProject } = require("../auto-upload/matching");

test("Given today files When scanning work folder Then only supported recent files are returned", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dohwa-upload-"));
  const recent = path.join(root, "발안일반산업단지 기술심의 신청서.hwp");
  const ignored = path.join(root, "notes.tmp");
  fs.writeFileSync(recent, "x");
  fs.writeFileSync(ignored, "x");

  const files = scanWorkFiles({
    rootDir: root,
    since: new Date(Date.now() - 60 * 1000),
    limit: 10
  });

  assert.equal(files.length, 1);
  assert.equal(files[0].name, path.basename(recent));
});

test("Given project names When matching file Then strongest project candidate wins", () => {
  const file = {
    name: "발안일반산업단지 공공폐수처리시설 기술심의 신청서.hwp",
    relativePath: "성과품/발안일반산업단지 공공폐수처리시설 기술심의 신청서.hwp"
  };
  const projects = [
    { prjCd: "A", prjNm: "다른 프로젝트" },
    { prjCd: "B", prjNm: "발안일반산업단지 공공폐수처리시설 증설공사 기본 및 실시설계용역" }
  ];

  const match = matchProject(file, projects);

  assert.equal(match.project.prjCd, "B");
  assert.ok(match.score > 0);
});

test("Given process keywords When matching category Then review category is selected", () => {
  const category = matchCategory(
    {
      name: "02_기술심의 신청서류.zip",
      relativePath: "수도시설 인허가/기술심의 신청자료/02_기술심의 신청서류.zip"
    },
    {}
  );

  assert.equal(category.name, "자문 및 심의");
});

test("Given low confidence file When building plan Then upload is blocked", () => {
  const plan = buildUploadPlan([{ name: "임시 메모.pdf", relativePath: "임시 메모.pdf" }], [], {});

  assert.equal(plan.summary.blocked, 1);
  assert.equal(plan.items[0].status, "blocked");
});
