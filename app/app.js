/* ================================================================
   EduTest – app.js
   Tarayıcıdan inputs/ klasörü okunamaz (CORS), bu yüzden
   test listesi manifest.json ile yönetilir.
   Her yeni JSON eklendiğinde manifest.json güncellenir.
   ================================================================ */

// ────────────────────────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────────────────────────
const state = {
  tests: [],          // { filename, meta } listesi
  current: null,      // aktif test verisi
  questionIndex: 0,
  answers: [],        // { chosen: label|null, correct: bool, skipped: bool }
  revealed: [],       // her soru için cevap gösterildi mi
  finished: false,
  userProgress: {}    // API'den gelen kaydedilmiş test ilerlemeleri (id => details)
};

// ────────────────────────────────────────────────────────────────
// DOM REFS
// ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const dom = {
  testList:       $('testList'),
  searchInput:    $('searchInput'),
  welcomeScreen:  $('welcomeScreen'),
  quizScreen:     $('quizScreen'),
  resultScreen:   $('resultScreen'),

  // Quiz header
  quizSubject:    $('quizSubject'),
  quizTitle:      $('quizTitle'),
  statDifficulty: $('statDifficulty'),
  statGrade:      $('statGrade'),
  progressLabel:  $('progressLabel'),
  progressPercent:$('progressPercent'),
  progressFill:   $('progressFill'),
  questionDots:   $('questionDots'),

  // Question
  questionNumber: $('questionNumber'),
  questionText:   $('questionText'),
  choicesGrid:    $('choicesGrid'),
  explanationBox: $('explanationBox'),
  explanationText:$('explanationText'),

  // Nav
  btnPrev:        $('btnPrev'),
  btnNext:        $('btnNext'),
  btnFinish:      $('btnFinish'),
  answeredCount:  $('answeredCount'),

  // Result
  resultTrophy:   $('resultTrophy'),
  resultTitle:    $('resultTitle'),
  resultSubtitle: $('resultSubtitle'),
  ringFg:         $('ringFg'),
  scoreNum:       $('scoreNum'),
  scoreTotal:     $('scoreTotal'),
  rsCorrect:      $('rsCorrect'),
  rsWrong:        $('rsWrong'),
  rsEmpty:        $('rsEmpty'),
  reviewList:     $('reviewList'),
  btnRestart:     $('btnRestart'),
  btnNewTest:     $('btnNewTest'),
};

// ────────────────────────────────────────────────────────────────
// SIDEBAR RESIZE
// ────────────────────────────────────────────────────────────────
(function initSidebarResize() {
  const sidebar    = document.getElementById('sidebar');
  const main       = document.getElementById('mainContent');
  const resizer    = document.getElementById('sidebarResizer');
  const MIN_W      = 180;
  const MAX_W      = 520;
  const KEY        = 'edutest_sidebar_w';

  // Kaydedilmiş genişliği uygula
  const saved = parseInt(localStorage.getItem(KEY), 10);
  if (saved && saved >= MIN_W && saved <= MAX_W) {
    sidebar.style.width = saved + 'px';
    main.style.marginLeft = saved + 'px';
  }

  let startX, startW;

  resizer.addEventListener('mousedown', e => {
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    resizer.classList.add('dragging');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    function onMove(e) {
      const delta = e.clientX - startX;
      const newW  = Math.min(MAX_W, Math.max(MIN_W, startW + delta));
      sidebar.style.width = newW + 'px';
      main.style.marginLeft = newW + 'px';
    }

    function onUp() {
      resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Genişliği kaydet
      localStorage.setItem(KEY, parseInt(sidebar.style.width, 10));
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
})();

// ────────────────────────────────────────────────────────────────
// BOOTSTRAP – Otomatik Klasör Tarama
// ────────────────────────────────────────────────────────────────
async function fetchDirectoryRecursive(url) {
  const jsonFiles = [];
  try {
    const res = await fetch(url);
    if (!res.ok) return jsonFiles;
    
    // Klasörün HTML sayfasını parse et (Python http.server çıktısı)
    const text = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'text/html');
    const links = Array.from(doc.querySelectorAll('a')).map(a => a.getAttribute('href'));

    for (const link of links) {
      if (link.startsWith('/') || link === '../' || link === './') continue; // Üst dizinlere atla
      
      const decodedLink = decodeURIComponent(link);
      
      // JSON dosyasıysa listeye ekle
      if (decodedLink.endsWith('.json') && decodedLink !== 'manifest.json') {
        const fullPath = url + link; // Fetch ederken un-decoded (UrlEncoded) link kullan
        
        // Klasör adını belirle (inputs/ sonrasındaki ana dizin)
        const decodedUrl = decodeURIComponent(url);
        const pathParts = (decodedUrl + decodedLink).split('inputs/');
        let folder = 'Ana Dizin';
        if (pathParts.length > 1) {
          const subParts = pathParts[1].split('/').filter(p => p !== '');
          if (subParts.length > 1) {
            folder = subParts.slice(0, -1).join('/');
          }
        }
        
        jsonFiles.push({ path: fullPath, folder });
      } 
      // Klasör ise (sonu / ile bitiyorsa) özyinelemeli olarak tara
      else if (decodedLink.endsWith('/')) {
        const subFiles = await fetchDirectoryRecursive(url + link);
        jsonFiles.push(...subFiles);
      }
    }
  } catch (e) {
    console.error('Klasör okunurken hata:', url, e);
  }
  return jsonFiles;
}

async function init() {
  try {
    dom.testList.innerHTML = `
      <div class="loading-tests">
        <div class="spinner"></div>
        <p>Klasörler aranıyor...</p>
      </div>`;

    // Sunucudan (status klasöründen) daha önce kaydedilmiş ilerlemeleri çek
    try {
      const statRes = await fetch('/api/status');
      if (statRes.ok) {
        state.userProgress = await statRes.json();
      }
    } catch(e) {
      console.warn("API'den ilerleme verisi okunamadı:", e);
    }
    
    // inputs/ klasörünü ve alt klasörlerini tara
    const files = await fetchDirectoryRecursive('/folders/inputs/');
    await loadTestList(files);
    
  } catch (e) {
    dom.testList.innerHTML = `
      <div class="no-tests">
        ⚠️ <strong>Sistem Hatası</strong><br/>
        Dosyalar okunamadı.<br/>
        Lütfen Python sunucusunun çalıştığından emin olun.
      </div>`;
  }
}

// ────────────────────────────────────────────────────────────────
// ARKA PLANA SENKRONİZASYON
// ────────────────────────────────────────────────────────────────
async function syncProgress() {
  if (!state.current) return;
  const total = state.current.questions.length;
  const correct = state.answers.filter(a => a.correct).length;
  const answered = state.answers.filter(a => !a.skipped).length;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;
  
  const payload = {
    test_id: state.current.meta.id,
    correct,
    total,
    answered,
    pct,
    finished: state.finished,
    answers: state.answers, // Bütün doğru/yanlış cevap durumu
    date: new Date().toISOString()
  };

  // State'i güncelle
  state.userProgress[state.current.meta.id] = payload;
  
  try {
    await fetch('/api/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    // Her kayıt sonrası Listeyi (Rozetleri) güncellemek için Event tetikle
    dom.searchInput.dispatchEvent(new Event('input'));
  } catch (e) {
    console.error("İlerleme api/status üzerine kaydedilemedi", e);
  }
}

// ────────────────────────────────────────────────────────────────
// TEST LİSTESİ YÜKLEME & GRUPLAMA
// ────────────────────────────────────────────────────────────────
async function loadTestList(filesGrouped) {
  const results = await Promise.allSettled(
    filesGrouped.map(item => fetch(item.path).then(r => r.json()).then(d => ({ 
      path: item.path, 
      folder: item.folder,
      meta: d.meta, 
      questions: d.questions 
    })))
  );

  state.tests = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  if (state.tests.length === 0) {
    dom.testList.innerHTML = `<div class="no-tests">inputs/ klasöründe geçerli test bulunamadı.</div>`;
    return;
  }

  renderTestList(state.tests);
}

function renderTestList(tests) {
  dom.testList.innerHTML = '';
  if (tests.length === 0) {
    dom.testList.innerHTML = `<div class="no-tests">Arama sonucu bulunamadı.</div>`;
    return;
  }

  // Klasör ağacını oluştur (Tree Data Structure)
  const tree = { _tests: [], _children: {} };
  tests.forEach(t => {
    const f = t.folder || 'Ana Dizin';
    const parts = f.split('/');
    let current = tree;
    parts.forEach(part => {
      if (!current._children[part]) {
        current._children[part] = { _tests: [], _children: {} };
      }
      current = current._children[part];
    });
    current._tests.push(t);
  });

  // Recursive render
  const FOLD_KEY = 'edutest_tree_open';
  const foldState = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}');

  function saveFoldState() {
    localStorage.setItem(FOLD_KEY, JSON.stringify(foldState));
  }

  function buildPath(parentPath, name) {
    return parentPath ? parentPath + '/' + name : name;
  }

  function renderTree(node, container, depth, parentPath) {
    // Önce klasörleri ekle
    for (const [folderName, childNode] of Object.entries(node._children)) {
      const nodePath = buildPath(parentPath, folderName);
      const details = document.createElement('details');
      details.className = 'folder-node';
      // Hafızaya bakarak aç/kapat, yoksa kapalı
      details.open = foldState[nodePath] === true;
      
      details.addEventListener('toggle', () => {
        foldState[nodePath] = details.open;
        saveFoldState();
      });

      const summary = document.createElement('summary');
      summary.className = 'folder-header';
      
      const icon = document.createElement('span');
      icon.className = 'folder-icon';
      icon.textContent = depth === 0 ? '📂' : '📁';
      
      const title = document.createElement('span');
      title.textContent = folderName;
      
      summary.appendChild(icon);
      summary.appendChild(title);
      details.appendChild(summary);
      
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'folder-children';
      details.appendChild(childrenContainer);
      
      container.appendChild(details);
      
      // Alt klasörleri ve içindeki testleri işle
      renderTree(childNode, childrenContainer, depth + 1, nodePath);
    }

    // Sonra bu klasörün içindeki testleri ekle (varsa)
    node._tests.forEach(t => {
      const item = document.createElement('div');
      item.className = 'test-item';
      item.dataset.id = t.meta.id;

      const diffClass = {
        'Kolay': 'difficulty-easy',
        'Orta': 'difficulty-medium',
        'Zor': 'difficulty-hard'
      }[t.meta.difficulty] ?? 'difficulty-medium';

      const stats = state.userProgress[t.meta.id];
      let badgeHtml = '';
      if (stats) {
        if (stats.finished) {
          badgeHtml = `<span class="test-completed-badge" title="Tarih: ${new Date(stats.date).toLocaleDateString('tr-TR')}">✓ %${stats.pct}</span>`;
        } else if (stats.answered > 0) {
          badgeHtml = `<span class="test-completed-badge" style="background:var(--yellow-bg);color:var(--yellow);border-color:rgba(251,191,36,.25)" title="Devam ediyor">⏳ ${stats.answered}/${stats.total}</span>`;
        }
      }

      item.innerHTML = `
        <div class="test-item-row1">
          <span class="test-title-text">${t.meta.title}</span>
        </div>
        ${badgeHtml}`;

      item.addEventListener('click', () => startTest(t));
      
      if (state.current && state.current.meta.id === t.meta.id) {
        item.classList.add('active');
      }

      container.appendChild(item);
    });
  }

  // Taramaya kök dizinden başla
  renderTree(tree, dom.testList, 0, '');

  // Marquee: her baskı sonrası kaçaman metinlerin scroll mesafesini ölç
  requestAnimationFrame(() => {
    dom.testList.querySelectorAll('.test-item').forEach(item => {
      const row1  = item.querySelector('.test-item-row1');
      const title = item.querySelector('.test-title-text');
      if (title && row1) {
        const overflow = title.scrollWidth - row1.clientWidth;
        title.style.setProperty('--scroll-px', overflow > 4 ? `-${overflow}px` : '0px');
      }
    });
  });
}

// Search
dom.searchInput.addEventListener('input', e => {
  const q = e.target.value.toLowerCase();
  const filtered = state.tests.filter(t =>
    t.meta.title.toLowerCase().includes(q) ||
    t.folder.toLowerCase().includes(q) ||
    (t.meta.subject ?? '').toLowerCase().includes(q) ||
    (t.meta.topic  ?? '').toLowerCase().includes(q)
  );
  renderTestList(filtered);
});

// ────────────────────────────────────────────────────────────────
// TEST BAŞLAT
// ────────────────────────────────────────────────────────────────
function startTest(testData, forceRestart = false) {
  state.current = testData;
  
  // Tekrar çöz denildiyse veya test baştan başlatılıyorsa eski durumu sil
  if (forceRestart) {
    state.userProgress[testData.meta.id] = null;
  }

  const savedStatus = state.userProgress[testData.meta.id];

  // Eğer bu teste daha önceden başlandıysa, cevapları geri yükle
  if (savedStatus) {
    state.answers = savedStatus.answers;
    state.finished = savedStatus.finished || false;
    // Hangi cevaplar işaretlenmişse onları 'açıklanmış/kilitli' olarak işaretle
    state.revealed = state.answers.map(a => !a.skipped);
    
    // Geri dönüldüğünde çözülmemiş ilk soruyu bulup oradan başla
    const firstUnanswered = state.answers.findIndex(a => a.skipped);
    state.questionIndex = firstUnanswered !== -1 ? firstUnanswered : 0;
  } 
  // Hiç başlanmadıysa sıfırdan yapılandır
  else {
    state.questionIndex = 0;
    state.answers = testData.questions.map(() => ({ chosen: null, correct: false, skipped: true }));
    state.revealed = testData.questions.map(() => false);
    state.finished = false;
  }

  // Sidebar aktif işareti
  document.querySelectorAll('.test-item').forEach(el => {
    el.classList.toggle('active', el.dataset.id === testData.meta.id);
  });

  // Eğer test bitmiş olarak işaretlendiyse doğrudan sonuç ekranına atla
  if (state.finished) {
    showResult(false); // Kayıt atmadan sonuçları göster
    return;
  }

  // Ekranlar
  showScreen('quiz');

  // Header
  const meta = testData.meta;
  dom.quizSubject.textContent = meta.subject ?? 'Test';
  dom.quizTitle.textContent = meta.topic || meta.title;

  const diffClass = { 'Kolay': 'difficulty-easy', 'Orta': 'difficulty-medium', 'Zor': 'difficulty-hard' }[meta.difficulty] ?? 'difficulty-medium';
  dom.statDifficulty.innerHTML = `<span class="stat-dot ${diffClass}"></span>${meta.difficulty ?? ''}`;
  dom.statGrade.textContent = meta.grade ?? '';

  buildDots();
  renderQuestion();
  
  // Test başlatıldığında kaydedelim (Böylece hemen 0/N olarak menüde görünür)
  syncProgress();
}

function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// ────────────────────────────────────────────────────────────────
// DOTS
// ────────────────────────────────────────────────────────────────
function buildDots() {
  dom.questionDots.innerHTML = '';
  state.current.questions.forEach((_, i) => {
    const dot = document.createElement('div');
    dot.className = 'q-dot';
    dot.textContent = i + 1;
    dot.addEventListener('click', () => {
      state.questionIndex = i;
      renderQuestion();
    });
    dom.questionDots.appendChild(dot);
  });
}

function updateDots() {
  const dots = dom.questionDots.querySelectorAll('.q-dot');
  dots.forEach((dot, i) => {
    dot.className = 'q-dot';
    if (i === state.questionIndex) dot.classList.add('current');
    else if (!state.answers[i].skipped) {
      dot.classList.add(state.answers[i].correct ? 'answered-correct' : 'answered-wrong');
    }
  });
}

// ────────────────────────────────────────────────────────────────
// SORU RENDER
// ────────────────────────────────────────────────────────────────
function renderQuestion() {
  const idx  = state.questionIndex;
  const q    = state.current.questions[idx];
  const total= state.current.questions.length;

  // Progress
  const answered = state.answers.filter(a => !a.skipped).length;
  const pct = Math.round((idx / total) * 100);
  dom.progressLabel.textContent  = `Soru ${idx + 1} / ${total}`;
  dom.progressPercent.textContent= `${pct}%`;
  dom.progressFill.style.width   = `${pct}%`;
  dom.answeredCount.textContent  = `${answered} / ${total} cevaplandı`;

  // Soru
  dom.questionNumber.textContent = String(idx + 1).padStart(2, '0');
  
  let qMediaHtml = '';
  if (q.images && q.images.length > 0) {
    qMediaHtml += `<div class="question-media">` + 
                 q.images.map(img => `<img src="${img}" class="zoomable" onclick="event.stopPropagation(); openLightbox('${img}')"/>`).join('') + 
                 `</div>`;
  }
  
  if (q.tikz && q.tikz.length > 0) {
    qMediaHtml += `<div class="question-tikz">` + 
      q.tikz.map(tikz => {
        const doc = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;justify-content:center;align-items:center;padding:10px}</style><link rel="stylesheet" href="https://tikzjax.com/v1/fonts.css"><script src="https://tikzjax.com/v1/tikzjax.js"></script></head><body><script type="text/tikz">${tikz.replace(/</g, '&lt;')}</script></body></html>`;
        return `<iframe srcdoc="${doc.replace(/"/g, '&quot;')}" style="border:none; width:100%; min-height:250px; background:#fff; border-radius:8px; margin-top:10px;"></iframe>`;
      }).join('') + `</div>`;
  }
  // Metin biçimlendirme fonksiyonu (bold ve ayraç desteği)
  function formatText(txt) {
    if (!txt) return '';
    // Bold: **metin**
    let formatted = txt.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    // Ayraç: ---
    formatted = formatted.replace(/^---$/gm, '<hr class="text-separator" />');
    return formatted;
  }

  dom.questionText.innerHTML = formatText(q.text) + qMediaHtml;

  // --- KOD BLOĞU DESTEĞI ---
  // Önceki sorudan kalan eski kod bloğunu temizle
  const existingCodeBlock = document.getElementById('qCodeBlock');
  if (existingCodeBlock) existingCodeBlock.remove();

  // q.code varsa şıkların hemen üstüne syntax-highlighted blok olarak ekle
  if (q.code) {
    const result  = window.hljs ? hljs.highlightAuto(q.code) : null;
    const highlighted = result ? result.value : escapeHtml(q.code);
    const langLabel = (result && result.language) ? result.language : 'kod';
    const codeBlock = document.createElement('div');
    codeBlock.id = 'qCodeBlock';
    codeBlock.className = 'code-block';
    codeBlock.innerHTML = `
      <div class="code-block-header">
        <span class="code-block-dots"><span></span><span></span><span></span></span>
        <span class="code-block-lang">${langLabel}</span>
      </div>
      <pre><code class="hljs">${highlighted}</code></pre>`;
    dom.choicesGrid.before(codeBlock);
  }

  // Şıklar
  dom.choicesGrid.innerHTML = '';
  q.choices.forEach(ch => {
    const btn = document.createElement('button');
    btn.className = 'choice-btn';
    btn.id = `choice-${ch.label}`;
    
    let cMediaHtml = '';
    if (ch.images && ch.images.length > 0) {
      cMediaHtml += `<div class="choice-media">` + 
                   ch.images.map(img => `<img src="${img}" class="zoomable" onclick="event.stopPropagation(); openLightbox('${img}')"/>`).join('') + 
                   `</div>`;
    }
    if (ch.tikz && ch.tikz.length > 0) {
      cMediaHtml += `<div class="choice-tikz">` + 
        ch.tikz.map(tikz => {
          const doc = `<!DOCTYPE html><html><head><style>body{margin:0;display:flex;justify-content:center;align-items:center;padding:10px}</style><link rel="stylesheet" href="https://tikzjax.com/v1/fonts.css"><script src="https://tikzjax.com/v1/tikzjax.js"></script></head><body><script type="text/tikz">${tikz.replace(/</g, '&lt;')}</script></body></html>`;
          return `<iframe srcdoc="${doc.replace(/"/g, '&quot;')}" style="border:none; width:100%; min-height:150px; background:#fff; border-radius:8px; margin-top:10px;"></iframe>`;
        }).join('') + `</div>`;
    }
    
    btn.innerHTML = `
      <span class="choice-label">${ch.label}</span>
      <span class="choice-text">${formatText(ch.text)}${cMediaHtml}</span>`;

    const ans = state.answers[idx];
    if (state.revealed[idx]) {
      // Cevap zaten açıklandı – sadece göster
      btn.disabled = true;
      if (ch.correct) btn.classList.add('correct');
      if (ch.label === ans.chosen && !ch.correct) btn.classList.add('wrong');
    } else if (ans.chosen === ch.label) {
      btn.classList.add('selected');
      btn.addEventListener('click', () => deselect(idx, ch.label));
    } else {
      btn.addEventListener('click', () => select(idx, ch.label));
    }
    dom.choicesGrid.appendChild(btn);
  });

  // Açıklama
  if (state.revealed[idx]) {
    dom.explanationBox.classList.remove('hidden');
    dom.explanationText.innerHTML = formatText(q.explanation) ?? '';
  } else {
    dom.explanationBox.classList.add('hidden');
  }

  // Nav butonları
  dom.btnPrev.style.visibility = idx === 0 ? 'hidden' : 'visible';

  const isLast = idx === total - 1;
  const allAnswered = state.answers.every(a => !a.skipped);
  dom.btnNext.classList.toggle('hidden', isLast && allAnswered);
  dom.btnFinish.classList.toggle('hidden', !(isLast || allAnswered));

  dom.btnNext.textContent = isLast ? 'Sonraki →' : 'Sonraki →';

  updateDots();

  // MathJax yeniden işle
  if (window.MathJax && MathJax.typesetPromise) {
    MathJax.typesetClear([dom.questionText, dom.choicesGrid, dom.explanationBox]);
    MathJax.typesetPromise([dom.questionText, dom.choicesGrid, dom.explanationBox]).catch(() => {});
  }
}

// ────────────────────────────────────────────────────────────────
// SEÇİM
// ────────────────────────────────────────────────────────────────
function select(idx, label) {
  const q   = state.current.questions[idx];
  const ans = state.answers[idx];
  ans.chosen  = label;
  ans.skipped = false;
  ans.correct = q.choices.find(c => c.label === label)?.correct ?? false;

  // Renk ver & kapat
  state.revealed[idx] = true;

  // Tüm butonları kilitle
  const btns = dom.choicesGrid.querySelectorAll('.choice-btn');
  btns.forEach(btn => {
    btn.disabled = true;
    const lbl = btn.querySelector('.choice-label').textContent;
    const ch  = q.choices.find(c => c.label === lbl);
    if (ch?.correct) btn.classList.add('correct');
    if (lbl === label && !ch?.correct) btn.classList.add('wrong');
    if (lbl === label) btn.classList.add('selected');
  });

  // Açıklama
  dom.explanationBox.classList.remove('hidden');
  dom.explanationText.innerHTML = q.explanation ?? '';

  if (window.MathJax && MathJax.typesetPromise) {
    MathJax.typesetClear([dom.choicesGrid, dom.explanationBox]);
    MathJax.typesetPromise([dom.choicesGrid, dom.explanationBox]).catch(() => {});
  }

  updateDots();

  const total = state.current.questions.length;
  const allAnswered = state.answers.every(a => !a.skipped);
  dom.btnFinish.classList.toggle('hidden', !(state.questionIndex === total - 1 || allAnswered));
  dom.btnNext.classList.toggle('hidden', state.questionIndex === total - 1 && allAnswered);

  dom.answeredCount.textContent = `${state.answers.filter(a => !a.skipped).length} / ${total} cevaplandı`;
  
  // Her şık işaretlendiğinde veriyi arka plan dosyasına kaydet
  syncProgress();
}

function deselect(idx, label) {
  // Cevap gösterilmişse iptal edilemez
  if (state.revealed[idx]) return;
  state.answers[idx] = { chosen: null, correct: false, skipped: true };
  renderQuestion();
}

// ────────────────────────────────────────────────────────────────
// NAVİGASYON
// ────────────────────────────────────────────────────────────────
dom.btnNext.addEventListener('click', () => {
  const total = state.current.questions.length;
  if (state.questionIndex < total - 1) {
    state.questionIndex++;
    renderQuestion();
  }
});

dom.btnPrev.addEventListener('click', () => {
  if (state.questionIndex > 0) {
    state.questionIndex--;
    renderQuestion();
  }
});

dom.btnFinish.addEventListener('click', showResult);

// ────────────────────────────────────────────────────────────────
// SONUÇ EKRANI
// ────────────────────────────────────────────────────────────────
function showResult(triggerSave = true) {
  state.finished = true;
  const answers = state.answers;
  const questions = state.current.questions;
  const total = questions.length;

  const correct = answers.filter(a => a.correct).length;
  const wrong   = answers.filter(a => !a.skipped && !a.correct).length;
  const empty   = answers.filter(a => a.skipped).length;
  const pct     = Math.round((correct / total) * 100);

  // JSON Dosyasına nihai bitmiş durumu ulaştır (Teste devamdan gelindiyse zaten kayıtlıdır diye false atılabilir)
  if (triggerSave) syncProgress();

  // Emoji & mesaj
  let trophy = '🏆', title = 'Mükemmel!', subtitle = '';
  if (pct >= 85) { trophy = '🏆'; title = 'Harika iş!'; }
  else if (pct >= 60) { trophy = '🎯'; title = 'İyi gidiyor!'; }
  else if (pct >= 40) { trophy = '📚'; title = 'Biraz daha çalış!'; }
  else { trophy = '💪'; title = 'Devam et, başarı yakın!'; }
  subtitle = `${total} sorudan ${correct} tanesini doğru yanıtladın (%${pct}).`;

  dom.resultTrophy.textContent = trophy;
  dom.resultTitle.textContent  = title;
  dom.resultSubtitle.textContent = subtitle;
  dom.scoreNum.textContent  = correct;
  dom.scoreTotal.textContent = total;
  dom.rsCorrect.textContent = correct;
  dom.rsWrong.textContent   = wrong;
  dom.rsEmpty.textContent   = empty;

  // Ring animasyonu
  const circumference = 2 * Math.PI * 52; // 326.7
  const offset = circumference - (pct / 100) * circumference;
  setTimeout(() => {
    dom.ringFg.style.strokeDashoffset = offset;
  }, 200);

  // Gradient tanımı SVG içine
  const svg = dom.ringFg.closest('svg');
  if (!svg.querySelector('defs')) {
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#6c63ff"/>
        <stop offset="100%" stop-color="#a78bfa"/>
      </linearGradient>`;
    svg.insertBefore(defs, svg.firstChild);
    dom.ringFg.setAttribute('stroke', 'url(#ringGrad)');
  }

  // Kullanıcının isteği doğrultusunda soruları alt alta listeleyen ekran kaldırıldı.
  dom.reviewList.innerHTML = '';

  showScreen('result');
}

// ────────────────────────────────────────────────────────────────
// ARAYÜZ KONTROL
// ────────────────────────────────────────────────────────────────
function showScreen(name) {
  dom.welcomeScreen.classList.add('hidden');
  dom.quizScreen.classList.add('hidden');
  dom.resultScreen.classList.add('hidden');
  if (name === 'welcome') dom.welcomeScreen.classList.remove('hidden');
  if (name === 'quiz')    dom.quizScreen.classList.remove('hidden');
  if (name === 'result')  dom.resultScreen.classList.remove('hidden');
}

// ────────────────────────────────────────────────────────────────
// RESULT BUTTONS
// ────────────────────────────────────────────────────────────────
dom.btnRestart.addEventListener('click', () => {
  if (state.current) startTest(state.current, true); // true = forceRestart
});

dom.btnNewTest.addEventListener('click', () => {
  document.querySelectorAll('.test-item').forEach(el => el.classList.remove('active'));
  showScreen('welcome');
});

// ────────────────────────────────────────────────────────────────
// START
// ────────────────────────────────────────────────────────────────
init();

// ────────────────────────────────────────────────────────────────
// LIGHTBOX (Resim Büyütme)
// ────────────────────────────────────────────────────────────────
let lightboxEl = null;

window.openLightbox = function(src) {
  if (!lightboxEl) {
    lightboxEl = document.createElement('div');
    lightboxEl.className = 'lightbox';
    lightboxEl.innerHTML = `
      <button class="lightbox-close" onclick="closeLightbox()">✕</button>
      <img id="lightbox-img" src="" alt="Yakınlaştırılmış Goruntu" />
    `;
    document.body.appendChild(lightboxEl);
    
    lightboxEl.addEventListener('click', (e) => {
      if (e.target === lightboxEl) closeLightbox();
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightboxEl.classList.contains('active')) {
        closeLightbox();
      }
    });
  }
  document.getElementById('lightbox-img').src = src;
  lightboxEl.classList.add('active');
};

window.closeLightbox = function() {
  if (lightboxEl) {
    lightboxEl.classList.remove('active');
  }
};
