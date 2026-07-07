const path = require("path");

const CATEGORY_RULES = [
  { name: "행정", keywords: ["행정", "계약", "착수", "준공계", "공문", "문서", "협의"] },
  { name: "기초자료", keywords: ["기초", "자료", "조사", "현황", "측량", "지반", "수질", "유량"] },
  { name: "보고자료", keywords: ["보고", "보고서", "월간", "주간", "진행", "회의록"] },
  { name: "공지사항 및 회의자료", keywords: ["공지", "회의", "회의자료", "회의록", "알림"] },
  { name: "검토자료", keywords: ["검토", "리뷰", "check", "검수", "의견"] },
  { name: "현장조사", keywords: ["현장", "출장", "사진", "조사", "점검"] },
  { name: "성과품 작성", keywords: ["성과품", "납품", "도면", "설계", "계산", "내역", "수량"] },
  { name: "자문 및 심의", keywords: ["자문", "심의", "기술심의", "신청서", "위원", "심사"] },
  { name: "인허가", keywords: ["인허가", "인·허가", "허가", "승인", "협의", "환경영향"] },
  { name: "기타업무", keywords: ["기타", "참고", "임시"] },
  { name: "공통자료", keywords: ["공통", "양식", "템플릿", "표준"] },
  { name: "준공후 AS", keywords: ["준공후", "as", "하자", "보완"] },
  { name: "업무공유자료", keywords: ["공유", "공유자료", "배포"] },
  { name: "부서협조", keywords: ["협조", "부서", "요청"] }
];

function stripHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z0-9#]+;/gi, " ");
}

function normalizeText(value) {
  return stripHtml(value)
    .normalize("NFKC")
    .replace(/[_()[\]{}.,;:|/\\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("ko-KR");
}

function tokens(value) {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function fileHaystack(file) {
  const parts = [
    file.name,
    file.relativePath,
    path.basename(file.name || "", path.extname(file.name || ""))
  ];
  return normalizeText(parts.join(" "));
}

function projectScore(fileText, project) {
  const projectName = normalizeText(project.prjNm || project.projectName || "");
  const projectCode = normalizeText(project.prjCd || project.projectCode || project.imsPrjNum || "");
  const projectTokens = tokens(projectName);
  let score = 0;

  if (projectCode && fileText.includes(projectCode)) score += 60;
  if (projectName && fileText.includes(projectName)) score += 100;

  for (const token of projectTokens) {
    if (fileText.includes(token)) score += token.length >= 4 ? 10 : 4;
  }
  return score;
}

function matchProject(file, projects, projectHint = "") {
  const hint = normalizeText(projectHint);
  const fileText = normalizeText(`${fileHaystack(file)} ${hint}`);
  const scored = projects
    .map((project) => ({ project, score: projectScore(fileText, project) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];

  return {
    project: best?.score > 0 ? best.project : null,
    score: best?.score || 0,
    alternatives: scored.slice(1, 4).map((item) => ({
      prjCd: item.project.prjCd,
      prjNm: item.project.prjNm,
      score: item.score
    }))
  };
}

function matchCategory(file, hints = {}) {
  const text = normalizeText([file.name, file.relativePath, hints.process, hints.category].join(" "));
  const scored = CATEGORY_RULES.map((rule) => {
    let score = 0;
    for (const keyword of rule.keywords) {
      if (text.includes(normalizeText(keyword))) score += keyword.length >= 4 ? 14 : 4;
    }
    if (normalizeText(rule.name) && text.includes(normalizeText(rule.name))) score += 12;
    return { name: rule.name, score };
  }).sort((a, b) => b.score - a.score);

  const best = scored[0];
  return best?.score > 0 ? best : { name: hints.category || "기타업무", score: 0 };
}

function confidenceFromScores(projectScoreValue, categoryScore) {
  const raw = Math.min(100, Math.round(projectScoreValue * 0.7 + categoryScore * 1.5));
  if (raw >= 75) return "high";
  if (raw >= 35) return "medium";
  return "low";
}

function buildUploadPlan(files, projects, options = {}) {
  const projectHint = options.projectHint || "";
  const categoryHint = options.categoryHint || "";
  const processHint = options.processHint || "";

  const items = files.map((file) => {
    const projectMatch = matchProject(file, projects, projectHint);
    const categoryMatch = matchCategory(file, { category: categoryHint, process: processHint });
    const project = projectMatch.project;
    const confidence = confidenceFromScores(projectMatch.score, categoryMatch.score);
    const blocked = !project || confidence === "low";
    return {
      file,
      target: {
        projectCode: project?.prjCd || "",
        projectName: project?.prjNm || "",
        projectState: project?.prjMngState || "",
        processName: processHint || categoryMatch.name,
        categoryName: categoryHint || categoryMatch.name,
        confidence,
        score: projectMatch.score + categoryMatch.score,
        alternatives: projectMatch.alternatives
      },
      status: blocked ? "blocked" : "planned",
      message: blocked ? "프로젝트 매칭 신뢰도가 낮아 자동 업로드를 보류했습니다." : "업로드 대상 후보가 준비되었습니다."
    };
  });

  return {
    items,
    summary: {
      total: items.length,
      ready: items.filter((item) => item.status === "planned").length,
      blocked: items.filter((item) => item.status === "blocked").length,
      uploaded: 0,
      failed: 0
    }
  };
}

module.exports = {
  CATEGORY_RULES,
  buildUploadPlan,
  matchCategory,
  matchProject,
  normalizeText
};
