const DEFAULT_BUDGET = 16000;

async function loadSettings() {
  const [syncResult, localResult] = await Promise.all([
    chrome.storage.sync.get({ particleBudget: DEFAULT_BUDGET }),
    chrome.storage.local.get({ targetImageDataUrl: "" })
  ]);
  return {
    particleBudget: syncResult.particleBudget,
    targetImageDataUrl: localResult.targetImageDataUrl
  };
}

async function saveSettings(particleBudget, targetImageDataUrl) {
  await chrome.storage.sync.set({ particleBudget });
  if (typeof targetImageDataUrl === "string") {
    await chrome.storage.local.set({ targetImageDataUrl });
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function init() {
  const budgetInput = document.getElementById("budget");
  const targetImageInput = document.getElementById("targetImage");
  const preview = document.getElementById("preview");
  const saveButton = document.getElementById("save");
  const settings = await loadSettings();
  budgetInput.value = String(settings.particleBudget || DEFAULT_BUDGET);
  let targetImageDataUrl = settings.targetImageDataUrl || "";

  if (targetImageDataUrl) {
    preview.src = targetImageDataUrl;
    preview.style.display = "block";
  }

  targetImageInput.addEventListener("change", async () => {
    const file = targetImageInput.files && targetImageInput.files[0];
    if (!file) return;
    targetImageDataUrl = await readFileAsDataUrl(file);
    preview.src = targetImageDataUrl;
    preview.style.display = "block";
  });

  saveButton.addEventListener("click", async () => {
    const nextBudget = Math.max(1000, Math.min(DEFAULT_BUDGET, Number(budgetInput.value) || DEFAULT_BUDGET));
    budgetInput.value = String(nextBudget);
    saveButton.disabled = true;
    try {
      await saveSettings(nextBudget, targetImageDataUrl);
      window.close();
    } finally {
      saveButton.disabled = false;
    }
  });
}

init();
