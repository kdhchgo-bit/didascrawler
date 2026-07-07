const path = require("path");
const { scanWorkFiles } = require("./auto-upload/files");
const { buildUploadPlan } = require("./auto-upload/matching");
const { fetchMyProjects, uploadPlanItems, withLoggedInPage } = require("./auto-upload/portal");
const { ensureDir, parseSince, readJson, resolveRuntimePath, safeFileName, writeJson } = require("./auto-upload/utils");

function parseArgs(argv) {
  const args = {
    config: "config.json",
    dryRun: true
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") args.config = argv[++i];
    else if (arg === "--work-dir") args.workDir = argv[++i];
    else if (arg === "--since") args.since = argv[++i];
    else if (arg === "--limit") args.limit = Number(argv[++i]);
    else if (arg === "--project-hint") args.projectHint = argv[++i];
    else if (arg === "--process-hint") args.processHint = argv[++i];
    else if (arg === "--category-hint") args.categoryHint = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--upload") args.dryRun = false;
    else if (arg === "--headless") args.headless = true;
    else if (arg === "--headed") args.headless = false;
  }
  return args;
}

function readConfig(filePath) {
  const resolved = path.resolve(__dirname, filePath);
  const config = readJson(resolved, null);
  if (!config) throw new Error(`Config file not found: ${resolved}`);
  return config;
}

function resolveAutoUploadOptions(args, config) {
  const autoUpload = config.autoUpload || {};
  const baseDir = process.env.DOHWA_DATA_ROOT || __dirname;
  return {
    workDir: resolveRuntimePath(args.workDir || autoUpload.workDir, baseDir),
    since: parseSince(args.since || autoUpload.since || "today"),
    limit: Math.max(1, Number(args.limit || autoUpload.limit || 50)),
    projectHint: args.projectHint || autoUpload.projectHint || "",
    processHint: args.processHint || autoUpload.processHint || "",
    categoryHint: args.categoryHint || autoUpload.categoryHint || "",
    dryRun: Boolean(args.dryRun),
    headless: args.headless ?? config.browser?.headless ?? false,
    outputDir: resolveRuntimePath(config.outputDir || "outputs", baseDir),
    dataRoot: baseDir
  };
}

function summarize(plan) {
  const summary = plan.summary;
  return `${summary.total}개 스캔, ${summary.ready}개 준비, ${summary.blocked}개 보류, ${summary.uploaded}개 업로드, ${summary.failed}개 실패`;
}

async function createPlan(config, options) {
  ensureDir(options.outputDir);
  console.log(`[scan] folder: ${options.workDir}`);
  console.log(`[scan] since: ${options.since.toISOString()}`);
  const files = scanWorkFiles({
    rootDir: options.workDir,
    since: options.since,
    limit: options.limit
  });
  console.log(`[scan] ${files.length} file(s) found`);

  return withLoggedInPage(config, options.dataRoot, options.outputDir, options.headless, async (page) => {
    const projects = await fetchMyProjects(page, options.outputDir);
    console.log(`[project] ${projects.length} project(s) captured`);
    const plan = buildUploadPlan(files, projects, options);
    return {
      capturedAt: new Date().toISOString(),
      dryRun: options.dryRun,
      workDir: options.workDir,
      since: options.since.toISOString(),
      limit: options.limit,
      projects: projects.map((project) => ({
        prjCd: project.prjCd,
        prjNm: project.prjNm,
        prjMngState: project.prjMngState
      })),
      files,
      ...plan
    };
  });
}

async function runAutoUpload(config, options) {
  const plan = await createPlan(config, options);
  const planPath = path.join(options.outputDir, "auto-upload-plan.json");
  writeJson(planPath, plan);
  console.log(`[plan] ${summarize(plan)}`);

  if (options.dryRun) {
    console.log("[upload] dry-run mode: no files were uploaded");
    return plan;
  }

  const uploaded = await withLoggedInPage(config, options.dataRoot, options.outputDir, options.headless, async (page) =>
    uploadPlanItems(page, plan, { limit: options.limit })
  );
  console.log(`[upload] ${summarize(uploaded)}`);
  return uploaded;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = readConfig(args.config);
  if (!config.credentials?.id || !config.credentials?.password) {
    throw new Error("ID와 비밀번호가 필요합니다.");
  }
  const options = resolveAutoUploadOptions(args, config);
  const result = await runAutoUpload(config, options);
  const fileName = options.dryRun ? "auto-upload-plan.json" : "auto-upload-result.json";
  const resultPath = path.join(options.outputDir, fileName);
  writeJson(resultPath, result);
  console.log(`[result] ${safeFileName(fileName)} saved`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  createPlan,
  parseArgs,
  resolveAutoUploadOptions,
  runAutoUpload
};
