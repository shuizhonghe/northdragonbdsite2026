const pages = document.getElementById('pages');
const slider = document.getElementById('slider');
const thumb = document.getElementById('slider-thumb');
const fill = slider.querySelector('.slider-fill');

const INSET = 4;     // 滑块与轨道内边距
const SNAP = 0.88;   // 拖过该比例即视为解锁

let maxX = 0;
let x = 0;
let startPointerX = 0;
let startOffset = 0;
let dragging = false;
let unlocked = false;

function measure() {
  maxX = slider.clientWidth - thumb.offsetWidth - INSET * 2;
}

function render() {
  thumb.style.transform = `translateX(${x}px)`;
  fill.style.width = `${thumb.offsetWidth + x}px`;
}

function setX(value) {
  x = Math.min(Math.max(value, 0), maxX);
  render();
}

function finishDrag() {
  if (!dragging) return;
  dragging = false;
  slider.classList.remove('is-dragging');

  if (x >= maxX * SNAP) {
    unlocked = true;
    setX(maxX);
    slider.classList.add('is-unlocked');
    thumb.setAttribute('aria-label', '已解锁');

    // 解锁完成后，整页上移，露出加载页
    setTimeout(() => {
      pages.classList.add('is-revealed');
      startLoadingSequence();
    }, 300);
  } else {
    setX(0);
  }
}

thumb.addEventListener('pointerdown', (event) => {
  if (unlocked) return;
  event.preventDefault();
  dragging = true;
  startPointerX = event.clientX;
  startOffset = x;
  slider.classList.add('is-dragging');
  thumb.setPointerCapture(event.pointerId);
});

window.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  setX(startOffset + (event.clientX - startPointerX));
});

window.addEventListener('pointerup', finishDrag);
window.addEventListener('pointercancel', finishDrag);

window.addEventListener('resize', () => {
  const wasUnlocked = unlocked;
  measure();
  if (wasUnlocked) x = maxX;
  setX(x);
});

measure();
render();

/* ---------- 加载恢复页：环形加载 + 数据丢失弹窗 ---------- */
const restoreModal = document.getElementById('restore-modal');
const restoreBtn = document.getElementById('restore-btn');
let loadingTimer = null;

function startLoadingSequence() {
  // 重置弹窗状态，环形加载条持续转动
  restoreModal.classList.remove('is-visible');
  restoreModal.setAttribute('aria-hidden', 'true');
  clearTimeout(loadingTimer);

  // 加载两秒后弹出"数据丢失"提示
  loadingTimer = setTimeout(() => {
    restoreModal.classList.add('is-visible');
    restoreModal.setAttribute('aria-hidden', 'false');
  }, 2000);
}

// 点击"是"后关闭弹窗，选关页直接覆盖在加载页之上
restoreBtn.addEventListener('click', () => {
  restoreModal.classList.remove('is-visible');
  restoreModal.setAttribute('aria-hidden', 'true');
  pages.classList.add('is-loaded');
});

/* ---------- 游戏一：4×4 拼图 ---------- */
const SIZE = 4;
const TILE_COUNT = SIZE * SIZE - 1;
const gameScreen = document.getElementById('game-screen');
const boardEl = document.getElementById('board');
const backBtn = document.getElementById('back-btn');
const solveBtn = document.getElementById('solve-btn');

const solvedBoard = Array.from({ length: TILE_COUNT }, (_, i) => i + 1).concat(0);
let board = solvedBoard.slice();
let puzzleSolved = false;

/* 选关进度：初始只开放游戏一 */
const gameRows = [...document.querySelectorAll('.game-row')];
const gameList = document.querySelector('.game-list');
const stageNext = document.getElementById('stage-next');
const stageBack = document.getElementById('stage-back');
let unlockedLevel = 1;
let completedLevel = 0;

function refreshLevels() {
  gameRows.forEach((row, index) => {
    const level = index + 1;
    const unlocked = level <= unlockedLevel;
    row.classList.toggle('is-locked', !unlocked);
    row.classList.toggle('is-done', level <= completedLevel);
    row.querySelector('.game-btn').disabled = !unlocked;
  });
  gameList.classList.toggle('is-two-done', completedLevel >= 2);
  gameList.classList.toggle('is-three-done', completedLevel >= 3);
  stageNext.classList.toggle('is-visible', completedLevel >= 3);
}

function markLevelComplete(level) {
  if (level > unlockedLevel) return;
  completedLevel = Math.max(completedLevel, level);
  if (level < gameRows.length) unlockedLevel = Math.max(unlockedLevel, level + 1);
  refreshLevels();
}

/* 资源清单：静态托管（GitHub Pages / Netlify 等）不提供目录列表，先用 manifest.json 枚举，
   读不到再回退到目录列表（本地 python http.server / file:// 之外的场景） */
const IMAGE_PATTERN = /\.(jpe?g|png|webp|gif|avif)$/i;
const AUDIO_PATTERN = /\.(mp3|ogg|wav|m4a|aac)$/i;
const TEXT_PATTERN = /\.txt$/i;

let manifestTask = null;

function loadAssetManifest() {
  if (!manifestTask) {
    manifestTask = fetch(new URL('assets/manifest.json', location.href), { cache: 'no-cache' })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null);
  }
  return manifestTask;
}

async function loadAssetPool(key, dir, pattern) {
  const manifest = await loadAssetManifest();
  const listed = manifest && Array.isArray(manifest[key]) ? manifest[key] : [];
  const fromManifest = listed
    .map((path) => {
      try {
        return pattern.test(new URL(path, location.href).pathname)
          ? new URL(path, location.href).href
          : null;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (fromManifest.length) return fromManifest;

  try {
    const base = new URL(dir, location.href);
    const response = await fetch(base);
    if (!response.ok) return [];

    const doc = new DOMParser().parseFromString(await response.text(), 'text/html');
    return [...doc.querySelectorAll('a[href]')]
      .map((link) => {
        try {
          const url = new URL(link.getAttribute('href'), base);
          return pattern.test(url.pathname) ? url.href : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    // file:// 下连目录都读不到时返回空数组，由调用方使用备用值
    return [];
  }
}

/* 图片池：优先读清单/目录，读不到时使用备用列表 */
const FALLBACK_IMAGES = ['assets/images/1.jpg'];
let imagePool = null;
let currentImage = null;

async function loadImagePool() {
  const pool = await loadAssetPool('images', 'assets/images/', IMAGE_PATTERN);
  if (pool.length) imagePool = pool;
}

function pickImage() {
  const pool = imagePool && imagePool.length ? imagePool : FALLBACK_IMAGES;
  let next = pool[0];

  if (pool.length > 1) {
    do {
      next = pool[Math.floor(Math.random() * pool.length)];
    } while (next === currentImage);
  }

  currentImage = next;
  return next;
}

const tileEls = new Map();

// 创建 15 块滑块，每块裁出大图对应的一格
for (let id = 1; id <= TILE_COUNT; id++) {
  const el = document.createElement('div');
  el.className = 'tile';
  el.dataset.id = String(id);

  const home = id - 1;                  // 它在大图中的正确位置
  const col = home % SIZE;
  const row = Math.floor(home / SIZE);
  el.style.backgroundPosition =
    `${(col / (SIZE - 1)) * 100}% ${(row / (SIZE - 1)) * 100}%`;

  boardEl.appendChild(el);
  tileEls.set(id, el);
}

function neighborsOf(index) {
  const row = Math.floor(index / SIZE);
  const col = index % SIZE;
  const result = [];
  if (row > 0) result.push(index - SIZE);
  if (row < SIZE - 1) result.push(index + SIZE);
  if (col > 0) result.push(index - 1);
  if (col < SIZE - 1) result.push(index + 1);
  return result;
}

function isAdjacent(a, b) {
  const rowGap = Math.abs(Math.floor(a / SIZE) - Math.floor(b / SIZE));
  const colGap = Math.abs((a % SIZE) - (b % SIZE));
  return rowGap + colGap === 1;
}

function place(animate) {
  boardEl.classList.toggle('no-anim', !animate);
  board.forEach((value, index) => {
    if (!value) return;
    const col = index % SIZE;
    const row = Math.floor(index / SIZE);
    tileEls.get(value).style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  });
  if (!animate) {
    void boardEl.offsetWidth;
    boardEl.classList.remove('no-anim');
  }
}

// 从完成状态做随机合法移动，保证打乱后一定有解
function shuffleBoard() {
  board = solvedBoard.slice();
  let blank = TILE_COUNT;
  let previous = -1;

  for (let step = 0; step < 260; step++) {
    const candidates = neighborsOf(blank).filter((index) => index !== previous);
    const next = candidates[Math.floor(Math.random() * candidates.length)];
    board[blank] = board[next];
    board[next] = 0;
    previous = blank;
    blank = next;
  }

  // 极小概率刚好回到完成态，再走一步打乱
  if (board.every((value, index) => value === solvedBoard[index])) {
    const next = neighborsOf(blank)[0];
    board[blank] = board[next];
    board[next] = 0;
  }
}

function checkSolved() {
  if (!board.every((value, index) => value === solvedBoard[index])) return;
  puzzleSolved = true;
  boardEl.classList.add('is-solved');
  markLevelComplete(1);
}

function openGame() {
  puzzleSolved = false;
  boardEl.classList.remove('is-solved');
  const imgSrc = pickImage();
  boardEl.style.setProperty('--puzzle', `url("${imgSrc}")`);
  // 拼图图片若加载失败，在控制台打印具体失败的 URL，方便排查托管问题
  const probe = new Image();
  probe.onerror = () => console.warn('[拼图图片加载失败]', imgSrc);
  probe.src = imgSrc;
  shuffleBoard();
  place(false);
  gameScreen.classList.add('is-open');
  gameScreen.setAttribute('aria-hidden', 'false');
}

function closeGame() {
  gameScreen.classList.remove('is-open');
  gameScreen.setAttribute('aria-hidden', 'true');
}

boardEl.addEventListener('click', (event) => {
  if (puzzleSolved) return;
  const tile = event.target.closest('.tile');
  if (!tile) return;

  const value = Number(tile.dataset.id);
  const from = board.indexOf(value);
  const blank = board.indexOf(0);
  if (!isAdjacent(from, blank)) return;

  board[blank] = value;
  board[from] = 0;
  place(true);
  checkSolved();
});

document.querySelector('[data-game="1"]').addEventListener('click', openGame);
backBtn.addEventListener('click', closeGame);

// 快速完成：滑块依次滑回正确位置
solveBtn.addEventListener('click', () => {
  if (puzzleSolved) return;
  board = solvedBoard.slice();
  place(true);
  puzzleSolved = true;

  setTimeout(() => {
    if (!puzzleSolved) return;
    boardEl.classList.add('is-solved');
    markLevelComplete(1);
  }, 260);
});

loadImagePool();
refreshLevels();

/* ---------- 三关通关后的新页面 ---------- */
/* 音乐池：优先读清单/目录，读不到时使用备用列表 */
const FALLBACK_TRACKS = ['assets/music/2ndBGM.mp3', 'assets/music/finalBGM.mp3'];
let musicPool = null;
let stageAudio = null;

async function loadMusicPool() {
  const pool = await loadAssetPool('music', 'assets/music/', AUDIO_PATTERN);
  if (pool.length) musicPool = pool;
}

function pickTrack() {
  const pool = musicPool && musicPool.length ? musicPool : FALLBACK_TRACKS;
  return pool[Math.floor(Math.random() * pool.length)];
}

/* 游戏二专属 BGM：在 music 目录中查找文件名含 2ndBGM 的音频 */
function pickGameTwoTrack() {
  const pool = musicPool && musicPool.length ? musicPool : FALLBACK_TRACKS;
  const hit = pool.find((src) => /2ndbgm/i.test(decodeURIComponent(src)));
  return hit || 'assets/music/2ndBGM.mp3';
}

/* 最终页专属音乐：在 music 目录中查找文件名含 finalBGA/finalBGM 的音频 */
function pickStageTrack() {
  const pool = musicPool && musicPool.length ? musicPool : FALLBACK_TRACKS;
  const hit = pool.find((src) => /finalbg[am]/i.test(decodeURIComponent(src)));
  return hit || 'assets/music/finalBGM.mp3';
}

/* 文本：最终页固定读取 text/ 目录中名为 finalTEXT 的文件 */
const FALLBACK_TEXT = 'assets/text/finalTEXT.txt';
const stageTextEl = document.getElementById('stage-text');
let textPool = null;

async function loadTextPool() {
  const pool = await loadAssetPool('text', 'assets/text/', TEXT_PATTERN);
  if (pool.length) textPool = pool;
}

async function loadStageText() {
  if (textPool === null) await loadTextPool();
  // 只取文件名含 finalTEXT 的文件，避免误读 catch-score.txt 之类的节奏谱
  const matched = (textPool || []).find((src) =>
    /finaltext/i.test(decodeURIComponent(src))
  );
  const source = matched || FALLBACK_TEXT;

  try {
    // 加时间戳避免缓存，txt 内容更新后再次进入即可看到
    const response = await fetch(`${source}${source.includes('?') ? '&' : '?'}t=${Date.now()}`);
    if (!response.ok) return;
    const text = await response.text();
    // 统一换行符，交给 CSS 的 white-space: pre-line 呈现原始分行
    stageTextEl.textContent = text.replace(/\r\n?/g, '\n').trim();
  } catch {
    // 读取失败时保留现有内容
  }
}

function openStage() {
  pages.classList.add('is-finished');
  loadStageText();

  // 在点击手势中同步播放，避免浏览器的自动播放限制
  const applyStageTrack = () => {
    if (!stageAudio) {
      stageAudio = new Audio(pickStageTrack());
      stageAudio.loop = true;
    }
    if (stageAudio.readyState > 0) stageAudio.currentTime = 0;
    const playing = stageAudio.play();
    if (playing) playing.catch(() => {});
  };

  if (musicPool === null) {
    loadMusicPool().then(applyStageTrack);
  } else {
    applyStageTrack();
  }
}

function closeStage() {
  pages.classList.remove('is-finished');
  if (stageAudio) stageAudio.pause();
}

stageNext.addEventListener('click', openStage);
stageBack.addEventListener('click', closeStage);
loadMusicPool();
loadTextPool();

/* ---------- 游戏二：接球 ---------- */
const gameTwo = document.getElementById('game-two');
const backTwo = document.getElementById('back-two');
const catchCanvas = document.getElementById('catch-canvas');
const catchCtx = catchCanvas.getContext('2d');
const catchScore = document.getElementById('catch-score');
const catchResult = document.getElementById('catch-result');
const catchResultText = document.getElementById('catch-result-text');
const catchRetry = document.getElementById('catch-retry');

const CATCH_RATE = 0.95;

/* 游戏二节奏谱：BPM 380，"." 为 note，每个空格多间隔一个八分音符
   谱子以 assets/text/catch-score.txt 为准：页面加载时自动读取并预处理成拍点数组，
   进入游戏二之前就已完成，改完谱子刷新页面即生效。
   下面的常量只是读取失败（如 file:// 直接打开）时的兜底谱子 */
const CATCH_BPM = 380;
const CATCH_EIGHTH = 30 / CATCH_BPM; // 八分音符时长（秒）
const CATCH_SCORE_FALLBACK = `
.   .   .  .  . .   .   .  .  . .   .   .  .  . .   .   .  .  . .   .   .  .  . .   .   .  .  . .   .   .  .  . .   .   .  .  . .   .   .  .  . .     .     .     .     .   .   .     .     .     .     .   .   .     .     .     .     .   .   .     .     .     .     .   .   .     .     .     .     .   .   .   .   .   .   .   .   . . . . .   .   .   .   .   . . . . . . .   .   .   .   .   .   . . . . . . . . . . . . .   . . . . .   .   . . .   . . .   . . . . . . .   . . . . . . .   .   .      .   . . .   . . .   . . . . . . .   . . .   .   .           . . . . . . . . . . . . . . . . . . .   . . .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .   .       .           .   .       .       .     .     .               .   .     .     .       .       .   .       .       .       .       .           .   .   .   .   .               .   .     .     .   .     .     .               .   .       .       .       .       .
`;

// 解析为整数拍点数组：每颗球位于第几个八分音符（首球为 0），全程整数无浮点累积
// 换行会被忽略，所以谱子既可以写成一行，也可以分行书写
function parseCatchScore(text) {
  const units = [];
  let slot = 0;
  let firstSlot = -1;

  for (const ch of text) {
    if (ch === '.') {
      if (firstSlot < 0) firstSlot = slot;
      units.push(slot - firstSlot);
      slot++;
    } else if (ch === ' ') {
      slot++;
    }
  }

  return units;
}

/* 拍点数组在页面加载时就预先读好；进入游戏二前只需等这个 Promise 完成即可 */
let catchUnits = parseCatchScore(CATCH_SCORE_FALLBACK);
let catchTotal = catchUnits.length;
let catchScoreTask = null;

function loadCatchScore() {
  const url = new URL('assets/text/catch-score.txt', location.href);
  return fetch(url, { cache: 'no-cache' })
    .then((response) => (response.ok ? response.text() : null))
    .then((text) => {
      if (!text) return;
      const units = parseCatchScore(text);
      if (!units.length) return;
      catchUnits = units;
      catchTotal = units.length;
    })
    .catch(() => {
      // 读取失败时保留兜底谱子
    });
}

function ensureCatchScore() {
  if (!catchScoreTask) catchScoreTask = loadCatchScore();
  return catchScoreTask;
}

ensureCatchScore();

let catchW = 0;
let catchH = 0;
let catchRadius = 10;
let catchSpeed = 0;
let catchPaddleW = 110;
let catchPaddleH = 14;
let catchPaddleY = 0;
let catchPaddleX = 0;
let catchAccent = '#e0705a';

let catchBalls = [];
let catchPattern = [];
let catchNext = 0;
let catchCaught = 0;
let catchElapsed = 0;
let catchLast = 0;
let catchRunning = false;
let catchHandle = 0;

let catchAudio = null;
let catchBgmStarted = false;

/* 小球皮肤：读取 assets/images/notes/ 下的图片，每颗球随机选一张 */
let notePool = null;
const noteImages = new Map();

async function loadNotePool() {
  const pool = await loadAssetPool('notes', 'assets/images/notes/', IMAGE_PATTERN);
  if (pool.length) notePool = pool;
}

function getNoteImage(src) {
  let img = noteImages.get(src);
  if (!img) {
    img = new Image();
    img.onerror = () => console.warn('[note 图片加载失败]', src);
    img.src = src;
    noteImages.set(src, img);
  }
  return img;
}

function pickNoteSkin() {
  if (!notePool || !notePool.length) return null;
  const src = notePool[Math.floor(Math.random() * notePool.length)];
  getNoteImage(src); // 提前开始加载，绘制时通常已就绪
  return src;
}

loadNotePool();

function readAccentColor() {
  catchAccent = getComputedStyle(document.documentElement)
    .getPropertyValue('--accent')
    .trim() || '#e0705a';
}

// 竖直间隔来自节奏谱（拍点 × 八分音符），水平位置随机但带「回中力」，避免连续贴边
function buildCatchPattern() {
  // note 贴图最大显示宽度为 4r，边上留出半个贴图宽度，保证靠边时也完整显示
  const margin = Math.min(catchRadius * 2 + 8, Math.max(catchW / 2 - 1, 1));
  const span = Math.max(catchW - margin * 2, 1);
  const center = catchW / 2;
  const pattern = [];
  let prevX = center;

  for (let i = 0; i < catchTotal; i++) {
    // 整数拍点 × 单位时长，单次乘法，避免浮点累积误差
    const time = catchUnits[i] * CATCH_EIGHTH;

    // 随机位移叠加回中力：离中心越远，越往中间拉，避免在边缘反复徘徊
    const pull = (center - prevX) * 0.6;
    const offset = (Math.random() * 2 - 1) * span * 0.35;
    const x = Math.min(Math.max(prevX + pull + offset, margin), catchW - margin);
    prevX = x;
    pattern.push({ x, time, skin: pickNoteSkin() });
  }

  return pattern;
}

function updateCatchScore() {
  catchScore.textContent = `接住 ${catchCaught} / ${catchTotal}`;
}

function drawCatchScene() {
  catchCtx.clearRect(0, 0, catchW, catchH);
  catchCtx.fillStyle = catchAccent;

  // 判定宽度为 2*catchRadius，皮肤最大显示宽度取其 2 倍
  const maxSide = catchRadius * 4;

  catchBalls.forEach((ball) => {
    const img = ball.skin ? getNoteImage(ball.skin) : null;

    if (img && img.complete && img.naturalWidth > 0) {
      // 等比缩放，保证图片完整显示且不超出最大边界
      const ratio = img.naturalWidth / img.naturalHeight;
      let w = maxSide;
      let h = maxSide / ratio;
      if (h > maxSide) {
        h = maxSide;
        w = maxSide * ratio;
      }
      catchCtx.drawImage(img, ball.x - w / 2, ball.y - h / 2, w, h);
      return;
    }

    catchCtx.beginPath();
    catchCtx.arc(ball.x, ball.y, catchRadius, 0, Math.PI * 2);
    catchCtx.fill();
  });

  catchCtx.beginPath();
  catchCtx.roundRect(
    catchPaddleX - catchPaddleW / 2,
    catchPaddleY,
    catchPaddleW,
    catchPaddleH,
    catchPaddleH / 2
  );
  catchCtx.fill();
}

function endCatchRound() {
  catchRunning = false;
  const passed = catchCaught / catchTotal >= CATCH_RATE;

  catchResultText.textContent = passed ? '通关！' : `接住 ${catchCaught} / ${catchTotal}`;
  catchRetry.hidden = passed;
  catchResult.classList.add('is-visible');

  if (passed) markLevelComplete(2);
}

function catchLoop(now) {
  if (!catchRunning) return;

  const dt = Math.min(Math.max((now - catchLast) / 1000, 0), 0.05);
  const prevElapsed = catchElapsed;
  catchLast = now;
  catchElapsed += dt;

  while (catchNext < catchPattern.length && catchElapsed >= catchPattern[catchNext].time) {
    // 记录生成时刻，位置每帧由时间反推，不逐帧累加
    catchBalls.push({
      x: catchPattern[catchNext].x,
      spawnTime: catchPattern[catchNext].time,
      skin: catchPattern[catchNext].skin,
      y: -catchRadius
    });
    catchNext++;
  }

  const hitHalf = catchPaddleW / 2 + catchRadius;
  catchBalls = catchBalls.filter((ball) => {
    const prevBottom = (prevElapsed - ball.spawnTime) * catchSpeed;
    const bottom = (catchElapsed - ball.spawnTime) * catchSpeed;
    ball.y = bottom - catchRadius;

    // 第一颗球接触接球板的瞬间开始播放 BGM
    if (!catchBgmStarted && prevBottom < catchPaddleY && bottom >= catchPaddleY) {
      catchBgmStarted = true;
      startCatchBgm();
    }

    if (
      prevBottom < catchPaddleY &&
      bottom >= catchPaddleY &&
      Math.abs(ball.x - catchPaddleX) <= hitHalf
    ) {
      catchCaught++;
      updateCatchScore();
      return false;
    }

    return ball.y - catchRadius <= catchH;
  });

  drawCatchScene();

  if (catchNext >= catchPattern.length && catchBalls.length === 0) {
    endCatchRound();
    return;
  }

  catchHandle = requestAnimationFrame(catchLoop);
}

function startCatchRound() {
  cancelAnimationFrame(catchHandle);
  catchRunning = false;

  const rect = catchCanvas.getBoundingClientRect();
  catchW = rect.width;
  catchH = rect.height;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  catchCanvas.width = Math.round(catchW * dpr);
  catchCanvas.height = Math.round(catchH * dpr);
  catchCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  readAccentColor();
  catchRadius = Math.max(8, Math.min(12, catchW * 0.014));
  catchSpeed = Math.max(260, catchH * 0.42);
  catchPaddleW = Math.max(90, Math.min(150, catchW * 0.22));
  catchPaddleY = catchH - Math.max(96, catchH * 0.16);
  catchPaddleX = catchW / 2;

  catchCaught = 0;
  catchElapsed = -0.8; // 开局留出 0.8s 准备时间
  catchNext = 0;
  catchBalls = [];
  catchPattern = buildCatchPattern();

  updateCatchScore();
  catchResult.classList.remove('is-visible');
  catchRetry.hidden = false;

  catchRunning = true;
  catchLast = performance.now();
  catchBgmStarted = false;
  catchHandle = requestAnimationFrame(catchLoop);
}

// 提前创建并预加载音频，确保触板瞬间无需等待网络与解码
function preloadCatchBgm() {
  if (catchAudio) return;
  catchAudio = new Audio(pickGameTwoTrack());
  catchAudio.loop = false; // 只播放一次
  catchAudio.preload = 'auto';
  catchAudio.load();
}

function startCatchBgm() {
  preloadCatchBgm();
  catchAudio.currentTime = 0;
  const playing = catchAudio.play();
  if (playing) playing.catch(() => {});
}

function stopCatchBgm() {
  if (!catchAudio) return;
  catchAudio.pause();
  catchAudio.currentTime = 0;
}

// 只负责让游戏页出现并预加载 BGM；本局开始由调用方在谱子就绪后触发
function openCatchGame() {
  gameTwo.classList.add('is-open');
  gameTwo.setAttribute('aria-hidden', 'false');
  // 进入游戏时就开始预加载 BGM，避免触板瞬间才开始下载解码
  if (musicPool === null) loadMusicPool().then(preloadCatchBgm);
  else preloadCatchBgm();
}

function closeCatchGame() {
  catchRunning = false;
  cancelAnimationFrame(catchHandle);
  stopCatchBgm();
  gameTwo.classList.remove('is-open');
  gameTwo.setAttribute('aria-hidden', 'true');
}

function moveCatchPaddle(event) {
  if (!catchRunning) return;
  const rect = catchCanvas.getBoundingClientRect();
  const half = catchPaddleW / 2;
  catchPaddleX = Math.min(Math.max(event.clientX - rect.left, half), catchW - half);
}

gameTwo.addEventListener('pointermove', moveCatchPaddle);
gameTwo.addEventListener('pointerdown', moveCatchPaddle);

// 进入游戏二：先立刻显示游戏页，再等谱子预处理完成才开局，避免读谱慢时点了没反应
document.querySelector('[data-game="2"]').addEventListener('click', async () => {
  if (gameTwo.classList.contains('is-open')) return;
  openCatchGame();
  await ensureCatchScore();
  startCatchRound();
});
backTwo.addEventListener('click', closeCatchGame);
catchRetry.addEventListener('click', startCatchRound);

// 快速完成：直接以通关结束本局，并停止 BGM
document.getElementById('solve-two').addEventListener('click', () => {
  if (!catchRunning) return;
  stopCatchBgm();
  catchCaught = catchTotal;
  updateCatchScore();
  endCatchRound();
});

window.addEventListener('resize', () => {
  if (gameTwo.classList.contains('is-open')) startCatchRound();
});

/* ---------- 游戏三：跳跃跑酷 ---------- */
const gameThree = document.getElementById('game-three');
const backThree = document.getElementById('back-three');
const runnerCanvas = document.getElementById('runner-canvas');
const runnerCtx = runnerCanvas.getContext('2d');
const runnerProgressFill = document.getElementById('runner-progress-fill');
const runnerResult = document.getElementById('runner-result');
const runnerResultText = document.getElementById('runner-result-text');
const runnerRetry = document.getElementById('runner-retry');

const RUNNER_DURATION = 15; // 秒，单局通关时长

/* 地面障碍下方的文字标签，作业与美景各自最多出现一次 */
const RUNNER_LABELS = ['作业', '生活', '美食', '游戏', '音乐', '美景'];
const RUNNER_LABEL_ONCE = new Set(['作业', '美景']);
const RUNNER_LABEL_FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
const RUNNER_FINISH_TEXT = '新的一年！';
let runnerLabelUsed = new Set();

let runnerW = 0;
let runnerH = 0;
let runnerGroundY = 0;
let runnerSpeed = 0;
let runnerGoal = 0;
let runnerDistance = 0;
let runnerElapsed = 0;
let runnerNextSpawn = 0;

let runnerPlayerSize = 30;
let runnerPlayerX = 0;
let runnerHeight = 0;
let runnerVy = 0;
let runnerGrounded = true;
let runnerGravity = 0;
let runnerJumpV = 0;

let runnerObstacles = [];
let runnerAccent = '#e0705a';
let runnerMuted = '#8a8078';

let runnerRunning = false;
let runnerLast = 0;
let runnerHandle = 0;

function drawRunnerScene() {
  const ctx = runnerCtx;
  ctx.clearRect(0, 0, runnerW, runnerH);

  // 地平线
  ctx.strokeStyle = runnerMuted;
  ctx.globalAlpha = 0.6;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, runnerGroundY);
  ctx.lineTo(runnerW, runnerGroundY);
  ctx.stroke();

  // 后退的地面纹理
  ctx.globalAlpha = 0.35;
  const step = 54;
  const offset = runnerDistance % step;
  for (let x = -offset; x < runnerW; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, runnerGroundY + 10);
    ctx.lineTo(x + 22, runnerGroundY + 10);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // 路面下方文字：字号随画布高度自适应
  const labelSize = Math.max(11, Math.min(16, runnerH * 0.022));
  const labelY = runnerGroundY + 18;
  ctx.font = `600 ${labelSize}px ${RUNNER_LABEL_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  // 终点线：与地面相对静止，随场景从右往左移动，最终到达角色位置
  const finishX = runnerPlayerX + (runnerGoal - runnerDistance);
  if (finishX < runnerW) {
    ctx.strokeStyle = runnerAccent;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 7]);
    ctx.beginPath();
    ctx.moveTo(finishX, runnerGroundY);
    ctx.lineTo(finishX, runnerGroundY - runnerH * 0.4);
    ctx.stroke();
    ctx.setLineDash([]);

    // 终点线下方的文字，与虚线一起移动
    ctx.fillStyle = runnerAccent;
    ctx.fillText(RUNNER_FINISH_TEXT, finishX, labelY);
  }

  // 障碍：全部是地面障碍，下方带文字标签
  runnerObstacles.forEach((ob) => {
    ctx.beginPath();
    ctx.roundRect(ob.x, ob.y, ob.w, ob.h, 4);
    ctx.fillStyle = runnerAccent;
    ctx.fill();

    // 标签画在路面下方，随障碍一起向左移动，与障碍保持相对静止
    ctx.fillStyle = runnerMuted;
    ctx.fillText(ob.label, ob.x + ob.w / 2, labelY);
  });

  // 角色方块（水平位置固定）
  ctx.fillStyle = runnerAccent;
  ctx.beginPath();
  ctx.roundRect(
    runnerPlayerX,
    runnerGroundY - runnerPlayerSize - runnerHeight,
    runnerPlayerSize,
    runnerPlayerSize,
    6
  );
  ctx.fill();
}

function pickRunnerLabel() {
  // 作业、美景出现一次后就不再进入候选池
  const pool = RUNNER_LABELS.filter(
    (label) => !(RUNNER_LABEL_ONCE.has(label) && runnerLabelUsed.has(label))
  );
  const label = pool[Math.floor(Math.random() * pool.length)];
  runnerLabelUsed.add(label);
  return label;
}

function spawnRunnerObstacle() {
  const size = runnerPlayerSize;
  const w = 18 + Math.random() * 10;
  const h = size + 4 + Math.random() * size * 0.4;
  runnerObstacles.push({
    x: runnerW + 30,
    y: runnerGroundY - h,
    w,
    h,
    label: pickRunnerLabel(),
  });
}

function endRunnerRound(passed) {
  runnerRunning = false;
  runnerResultText.textContent = passed ? '通关！' : '撞到了！';
  runnerRetry.hidden = passed;
  runnerResult.classList.add('is-visible');

  if (passed) {
    runnerProgressFill.style.width = '100%';
    markLevelComplete(3);
  }
}

function runnerLoop(now) {
  if (!runnerRunning) return;

  const dt = Math.min(Math.max((now - runnerLast) / 1000, 0), 0.05);
  runnerLast = now;
  runnerElapsed += dt;
  runnerDistance += runnerSpeed * dt;

  // 跳跃物理：起跳首帧高度可能仍为 0，必须同时满足下落才算落地
  if (!runnerGrounded) {
    runnerHeight += runnerVy * dt;
    runnerVy -= runnerGravity * dt;
    if (runnerHeight <= 0 && runnerVy <= 0) {
      runnerHeight = 0;
      runnerVy = 0;
      runnerGrounded = true;
    }
  }

  // 生成障碍（终点前留出安全距离）
  if (runnerElapsed >= runnerNextSpawn && runnerGoal - runnerDistance > runnerSpeed * 1.8) {
    spawnRunnerObstacle();
    runnerNextSpawn = runnerElapsed + 1.2 + Math.random() * 0.7;
  }

  // 移动与碰撞
  const inset = 3;
  const playerX = runnerPlayerX + inset;
  const playerY = runnerGroundY - runnerPlayerSize - runnerHeight + inset;
  const playerW = runnerPlayerSize - inset * 2;
  const playerH = runnerPlayerSize - inset * 2;

  let hit = false;
  runnerObstacles.forEach((ob) => {
    ob.x -= runnerSpeed * dt;
    if (
      playerX < ob.x + ob.w - inset &&
      playerX + playerW > ob.x + inset &&
      playerY < ob.y + ob.h - inset &&
      playerY + playerH > ob.y + inset
    ) {
      hit = true;
    }
  });
  runnerObstacles = runnerObstacles.filter((ob) => ob.x + ob.w > -10);

  if (hit) {
    drawRunnerScene();
    endRunnerRound(false);
    return;
  }

  drawRunnerScene();
  runnerProgressFill.style.width = `${Math.min(100, (runnerDistance / runnerGoal) * 100)}%`;

  if (runnerDistance >= runnerGoal) {
    endRunnerRound(true);
    return;
  }

  runnerHandle = requestAnimationFrame(runnerLoop);
}

function startRunnerRound() {
  cancelAnimationFrame(runnerHandle);
  runnerRunning = false;

  const rect = runnerCanvas.getBoundingClientRect();
  runnerW = rect.width;
  runnerH = rect.height;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  runnerCanvas.width = Math.round(runnerW * dpr);
  runnerCanvas.height = Math.round(runnerH * dpr);
  runnerCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const styles = getComputedStyle(document.documentElement);
  runnerAccent = styles.getPropertyValue('--accent').trim() || '#e0705a';
  runnerMuted = styles.getPropertyValue('--muted').trim() || '#8a8078';

  runnerGroundY = runnerH * 0.68;
  runnerSpeed = Math.max(280, runnerW * 0.34);
  runnerGoal = runnerSpeed * RUNNER_DURATION;

  runnerPlayerSize = Math.max(26, Math.min(36, runnerH * 0.045));
  runnerPlayerX = runnerW * 0.22;

  runnerGravity = runnerH * 3.2;
  runnerJumpV = Math.sqrt(2 * runnerGravity * runnerH * 0.12);

  runnerHeight = 0;
  runnerVy = 0;
  runnerGrounded = true;

  runnerObstacles = [];
  runnerLabelUsed = new Set();
  runnerElapsed = 0;
  runnerDistance = 0;
  runnerNextSpawn = 2.2;

  runnerProgressFill.style.width = '0%';
  runnerResult.classList.remove('is-visible');
  runnerRetry.hidden = false;

  runnerRunning = true;
  runnerLast = performance.now();
  runnerHandle = requestAnimationFrame(runnerLoop);
}

function jumpRunner() {
  if (!runnerRunning || !runnerGrounded) return;
  runnerGrounded = false;
  runnerVy = runnerJumpV;
}

function openRunnerGame() {
  gameThree.classList.add('is-open');
  gameThree.setAttribute('aria-hidden', 'false');
  startRunnerRound();
}

function closeRunnerGame() {
  runnerRunning = false;
  cancelAnimationFrame(runnerHandle);
  gameThree.classList.remove('is-open');
  gameThree.setAttribute('aria-hidden', 'true');
}

gameThree.addEventListener('pointerdown', (event) => {
  if (event.target.closest('button')) return;
  jumpRunner();
});

window.addEventListener('keydown', (event) => {
  if (!gameThree.classList.contains('is-open')) return;
  if (event.code === 'Space' || event.code === 'ArrowUp') {
    event.preventDefault();
    jumpRunner();
  }
});

document.querySelector('[data-game="3"]').addEventListener('click', openRunnerGame);
backThree.addEventListener('click', closeRunnerGame);
runnerRetry.addEventListener('click', startRunnerRound);

// 快速完成：直接判定到达终点
document.getElementById('solve-three').addEventListener('click', () => {
  if (!runnerRunning) return;
  runnerDistance = runnerGoal;
  endRunnerRound(true);
});

window.addEventListener('resize', () => {
  if (gameThree.classList.contains('is-open')) startRunnerRound();
});

