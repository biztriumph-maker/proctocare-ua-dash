#!/usr/bin/env node
/**
 * Comprehensive Regression Test Suite
 * Tests: History enrichment + Pencil editor save + Last visit label
 * Validates: Desktop + Mobile + Supabase persistence
 * 
 * Tests three critical fixes together before release:
 * 1. Last visit label correctly shows latest completed visit (20.05.2025)
 * 2. Pencil editor changes persist to Supabase
 * 3. History enrichment provides full visit timeline
 */

import { chromium, devices } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.VITE_DEV_SERVER || "http://localhost:8080";
const TEST_PATIENT_ID = "test-history-visit-active-20260401";
const EXPECTED_LAST_VISIT = "20.05.2025"; // Latest completed visit, skips 10.05 (no-show)

// Supabase client for DB validation (optional)
let supabase = null;
try {
  const url = process.env.VITE_SUPABASE_TEST_URL;
  const key = process.env.VITE_SUPABASE_TEST_ANON_KEY;
  if (url && key) {
    supabase = createClient(url, key);
    console.log("✅ Supabase client initialized");
  } else {
    console.log("⚠️  Supabase environment not configured - skipping DB validation");
  }
} catch (err) {
  console.log("⚠️  Supabase unavailable - testing UI only");
}

const results = {
  ok: true,
  baseUrl: BASE_URL,
  timestamp: new Date().toISOString(),
  tests: {
    lastVisitLabel: { desktop: null, mobile: null },
    pencilSave: { desktop: null, mobile: null },
    historyEnrichment: { desktop: null, mobile: null },
  },
  summary: {},
};

async function testLastVisitLabel(context, mode) {
  try {
    const page = await context.newPage();
    page.on("console", (msg) => console.log(`[${mode}] ${msg.text()}`));

    await page.goto(`${BASE_URL}/`);

    // Wait for patient list and search for test patient
    await page.waitForSelector("[data-patient-id]", { timeout: 10000 });

    // Use search or scroll to find test patient
    const searchInput = await page.$("input[placeholder*='Пошук']");
    if (searchInput) {
      await searchInput.fill("test-history-visit-active");
      await page.waitForTimeout(500);
    }

    // Find and click test patient
    const patientCard = await page.locator(`[data-patient-id="${TEST_PATIENT_ID}"]`).first();
    if (!patientCard) {
      throw new Error(`Patient card not found for ${TEST_PATIENT_ID}`);
    }

    await patientCard.click();
    await page.waitForTimeout(800); // Wait for modal to open

    // Check last visit label
    const lastVisitText = await page.locator("text=Останній візит").first();
    if (!lastVisitText) {
      throw new Error("Last visit label not found");
    }

    // Get the date displayed next to label
    const dateElement = await page.locator("text=Останній візит").first().locator("..").locator("text=/\\d{1,2}\\.\\d{2}\\.\\d{4}/");
    const displayedDate = await dateElement.textContent();

    const hasCorrectDate = displayedDate && displayedDate.includes(EXPECTED_LAST_VISIT);

    results.tests.lastVisitLabel[mode] = {
      mode,
      displayedDate,
      expected: EXPECTED_LAST_VISIT,
      pass: hasCorrectDate,
      message: hasCorrectDate
        ? `✅ Correct: showing ${EXPECTED_LAST_VISIT}`
        : `❌ Wrong: showing ${displayedDate}, expected ${EXPECTED_LAST_VISIT}`,
    };

    if (!hasCorrectDate) results.ok = false;

    await page.close();
  } catch (err) {
    results.ok = false;
    results.tests.lastVisitLabel[mode] = {
      mode,
      pass: false,
      error: err.message,
    };
    console.error(`[${mode}] Last visit label test failed:`, err.message);
  }
}

async function testPencilSave(context, mode) {
  try {
    const page = await context.newPage();
    const logs = [];
    page.on("console", (msg) => {
      const text = msg.text();
      if (text.includes("Saving") || text.includes("success") || text.includes("error")) {
        logs.push(text);
        console.log(`[${mode}] ${text}`);
      }
    });

    await page.goto(`${BASE_URL}/`);

    // Find and open test patient
    await page.waitForSelector("[data-patient-id]", { timeout: 10000 });

    const searchInput = await page.$("input[placeholder*='Пошук']");
    if (searchInput) {
      await searchInput.fill("test-history-visit-active");
      await page.waitForTimeout(500);
    }

    const patientCard = await page.locator(`[data-patient-id="${TEST_PATIENT_ID}"]`).first();
    await patientCard.click();
    await page.waitForTimeout(800);

    // Look for protocol field and pencil icon
    const protocolInput = await page.$("textarea[value*=''], textarea");
    if (!protocolInput) {
      throw new Error("Protocol textarea not found");
    }

    // Find pencil edit button near protocol
    const editButton = await page.locator("button[title*='Редагув'], button:has-text('✏️')").first();
    if (!editButton) {
      throw new Error("Edit button not found");
    }

    await editButton.click();
    await page.waitForTimeout(500);

    // Find the textarea in edit modal
    const modalTextarea = await page.locator("textarea").last();
    if (!modalTextarea) {
      throw new Error("Modal textarea not found");
    }

    // Clear and add test content
    const testContent = `TEST-SAVE-CHECK-${Date.now()}`;
    await modalTextarea.fill("");
    await modalTextarea.type(testContent);

    // Find and click save button
    const saveButton = await page.locator("button:has-text('Зберегти')").last();
    if (!saveButton) {
      throw new Error("Save button not found");
    }

    await saveButton.click();
    await page.waitForTimeout(1500);

    // Verify UI shows the new value
    const uiHasValue = await page.locator(`text=${testContent}`).count() > 0;
    console.log(`[${mode}] UI verification: ${uiHasValue ? "✅ value present" : "❌ value missing"}`);

    // Direct Supabase query to verify persistence
    let dbHasValue = false;
    const dbChecked = supabase ? true : false;
    
    if (supabase) {
      try {
        const { data, error } = await supabase.from("visits").select("protocol").eq("id", TEST_PATIENT_ID).single();

        if (!error && data) {
          dbHasValue = data.protocol && data.protocol.includes(testContent);
          console.log(`[${mode}] DB verification: ${dbHasValue ? "✅ persisted" : "❌ not found"}`);
        } else {
          console.log(`[${mode}] DB query error:`, error?.message);
        }
      } catch (dbErr) {
        console.log(`[${mode}] DB connection error:`, dbErr.message);
      }
    } else {
      console.log(`[${mode}] DB validation skipped (Supabase not configured)`);
    }

    results.tests.pencilSave[mode] = {
      mode,
      testContent,
      uiHasValue,
      dbHasValue: dbChecked ? dbHasValue : null,
      pass: dbChecked ? (uiHasValue && dbHasValue) : uiHasValue,
      saveLogs: logs,
      message: dbChecked
        ? (uiHasValue && dbHasValue
          ? "✅ Save successful: UI + DB verified"
          : `❌ Save failed: UI=${uiHasValue}, DB=${dbHasValue}`)
        : (uiHasValue
          ? "✅ Save successful: UI verified (DB not configured)"
          : "❌ Save failed: UI update missing"),
    };

    if (!results.tests.pencilSave[mode].pass) results.ok = false;

    await page.close();
  } catch (err) {
    results.ok = false;
    results.tests.pencilSave[mode] = {
      mode,
      pass: false,
      error: err.message,
    };
    console.error(`[${mode}] Pencil save test failed:`, err.message);
  }
}

async function testHistoryEnrichment(context, mode) {
  try {
    const page = await context.newPage();
    page.on("console", (msg) => console.log(`[${mode}] ${msg.text()}`));

    await page.goto(`${BASE_URL}/`);

    // Find and open test patient
    await page.waitForSelector("[data-patient-id]", { timeout: 10000 });

    const searchInput = await page.$("input[placeholder*='Пошук']");
    if (searchInput) {
      await searchInput.fill("test-history-visit-active");
      await page.waitForTimeout(500);
    }

    const patientCard = await page.locator(`[data-patient-id="${TEST_PATIENT_ID}"]`).first();
    await patientCard.click();
    await page.waitForTimeout(1000);

    // Check for history/timeline elements
    const historyItems = await page.locator("[class*='history'], [class*='timeline'], [class*='archive']").count();
    const protocolHistoryExists = await page.locator("text=Історія протоколів, text=Архів дат").count() > 0;

    // Verify multiple visit dates are visible (from enrichment)
    const multipleVisitDatesVisible = await page.locator("text=/\\d{1,2}\\.\\d{2}\\.\\d{4}/").count() >= 3;

    results.tests.historyEnrichment[mode] = {
      mode,
      historyElementsCount: historyItems,
      protocolHistoryVisible: protocolHistoryExists,
      multipleDatesVisible: multipleVisitDatesVisible,
      pass: multipleVisitDatesVisible,
      message: multipleVisitDatesVisible
        ? "✅ History enrichment working: multiple visit dates visible"
        : `❌ History enrichment missing: expected multiple dates, found ${historyItems} elements`,
    };

    if (!multipleVisitDatesVisible) results.ok = false;

    await page.close();
  } catch (err) {
    results.ok = false;
    results.tests.historyEnrichment[mode] = {
      mode,
      pass: false,
      error: err.message,
    };
    console.error(`[${mode}] History enrichment test failed:`, err.message);
  }
}

async function main() {
  console.log(`🚀 Starting comprehensive regression test suite...`);
  console.log(`📍 Server: ${BASE_URL}`);
  console.log(`👤 Test patient: ${TEST_PATIENT_ID}`);
  console.log(`📅 Expected last visit: ${EXPECTED_LAST_VISIT}\n`);

  const browser = await chromium.launch();
  let testsPassed = 0;
  let testsFailed = 0;

  try {
    // Desktop tests
    console.log("═══════════════════════════════════════");
    console.log("🖥️  DESKTOP MODE");
    console.log("═══════════════════════════════════════\n");

    const desktopContext = await browser.newContext();
    await testLastVisitLabel(desktopContext, "desktop");
    await testPencilSave(desktopContext, "desktop");
    await testHistoryEnrichment(desktopContext, "desktop");
    await desktopContext.close();

    // Mobile tests
    console.log("\n═══════════════════════════════════════");
    console.log("📱 MOBILE MODE (Pixel 7 emulation)");
    console.log("═══════════════════════════════════════\n");

    const mobileContext = await browser.newContext({
      ...devices["Pixel 7"],
      viewport: { width: 412, height: 915 },
    });
    await testLastVisitLabel(mobileContext, "mobile");
    await testPencilSave(mobileContext, "mobile");
    await testHistoryEnrichment(mobileContext, "mobile");
    await mobileContext.close();

    // Summary
    console.log("\n═══════════════════════════════════════");
    console.log("📊 TEST SUMMARY");
    console.log("═══════════════════════════════════════\n");

    for (const [testName, modes] of Object.entries(results.tests)) {
      for (const [mode, result] of Object.entries(modes)) {
        if (result.pass) {
          testsPassed++;
          console.log(`✅ ${testName} (${mode}): ${result.message}`);
        } else {
          testsFailed++;
          console.log(`❌ ${testName} (${mode}): ${result.message || result.error}`);
        }
      }
    }

    results.summary = {
      total: testsPassed + testsFailed,
      passed: testsPassed,
      failed: testsFailed,
      status: results.ok ? "🟢 ALL TESTS PASSED" : "🔴 SOME TESTS FAILED",
    };

    console.log(`\n${results.summary.status}`);
    console.log(`Passed: ${testsPassed}/${results.summary.total}`);
    console.log(`Failed: ${testsFailed}/${results.summary.total}`);
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify(results, null, 2));
  process.exit(results.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
