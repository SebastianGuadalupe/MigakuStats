// ==UserScript==
// @name         Migaku Custom Stats
// @namespace    http://tampermonkey.net/
// @version      0.0.6
// @description  Custom stats for Migaku Memory.
// @author       sguadalupe
// @match        https://study.migaku.com
// @match        https://study.migaku.com/statistic
// @match        https://study.migaku.com/collection
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js
// @grant        GM_addStyle
// ==/UserScript==

/* global pako, initSqlJs, Chart */

(function () {
  "use strict";
  const ENVIROMENT = "dev";

  const css = `
    .MCS__container {
        margin: 32px 0;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .MCS__wordcount {
        display: flex;
        gap: 16px;
        align-items: center;
        justify-content: space-around;
        padding: 8px 0;
    }

    .MCS__deck-selector {
        margin: 16px 0;
    }
    `;

  const themeConfigs = {
    dark: {
      textColor: "rgba(255, 255, 255, 1)",
      tooltipBg: "#2b2b60",
      gridColor: "rgba(255, 255, 255, 0.1)",
      knownColor: "rgba(0, 199, 164, 1)",
      learningColor: "rgba(0, 199, 164, 0.4)",
      unknownColor: "rgba(255, 255, 255, 0.12)",
      ignoredColor: "rgba(255, 255, 255, 0.35)",
      barColor: "rgba(0, 199, 164, 1)",
    },
    light: {
      textColor: "rgba(0, 0, 90, 1)",
      tooltipBg: "rgba(255, 255, 255, 1)",
      gridColor: "rgba(0, 0, 0, 0.1)",
      knownColor: "rgba(0, 199, 164, 1)",
      learningColor: "rgba(0, 199, 164, 0.4)",
      unknownColor: "rgba(0, 0, 90, 0.07)",
      ignoredColor: "rgba(0, 0, 90, 0.15)",
      barColor: "rgba(0, 199, 164, 1)",
    },
  };

  function getCurrentTheme() {
    return document.documentElement.getAttribute("data-mgk-theme") || "dark";
  }

  function getThemeColors() {
    const theme = getCurrentTheme();
    return themeConfigs[theme] || themeConfigs.dark;
  }

  let migakuTooltip = {
    cornerRadius: 20,
    padding: 12,
    caretSize: 0,
  };
  GM_addStyle(css);

  function createExtensionLogger() {
    return function () {
      const args = Array.from(arguments);
      if (ENVIROMENT === "dev") {
        console.log("Migaku Custom Stats:", ...args);
      }
    };
  }
  const extensionLog = createExtensionLogger();

  const dbName = "srs";
  const objectStoreName = "data";
  const statisticsElementSelector = ".Statistic";
  const targetElementSelector = ".UiPageLayout";
  const statsRoute = "/statistic";
  let migakuDB = null;
  let isProcessing = false;
  let selectedLanguage = null;
  let languageChangeObserver = null;
  let themeChangeObserver = null;
  let wordChartInstance = null;
  let dueChartInstance = null;
  let lastWordStats = null;
  let lastDueStats = null;
  let availableDecks = [];
  let selectedDeckId = "all";

  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const observer = new MutationObserver((_, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          extensionLog(`Element '${selector}' detected.`);
          obs.disconnect();
          resolve(element);
        }
      });

      const element = document.querySelector(selector);
      if (element) {
        extensionLog(`Element '${selector}' found immediately.`);
        resolve(element);
        return;
      }

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        if (!document.querySelector(selector)) {
          observer.disconnect();
          extensionLog(
            `Element '${selector}' not found via MutationObserver after ${timeout}ms.`
          );
          resolve(null);
        }
      }, timeout);
    });
  }

  function initDB() {
    return new Promise((resolve, reject) => {
      if (migakuDB) {
        extensionLog("Using existing DB connection.");
        resolve(migakuDB);
        return;
      }

      extensionLog("Attempting to open IndexedDB...");
      const request = indexedDB.open(dbName);

      request.onerror = (event) => {
        extensionLog(`IndexedDB error: ${event.target.errorCode}`);
        reject(new Error(`IndexedDB error: ${event.target.errorCode}`));
      };

      request.onsuccess = (event) => {
        extensionLog("Successfully connected to Migaku DB:", dbName);
        migakuDB = event.target.result;
        resolve(migakuDB);
      };

      request.onupgradeneeded = () => {
        extensionLog(
          "Database upgrade needed (or first time setup). This script doesn't handle upgrades."
        );
      };
    });
  }

  async function runStatsLogic() {
    if (window.location.pathname !== statsRoute) {
      extensionLog("Not on stats route, skipping logic.");
      if (languageChangeObserver) {
        extensionLog("Disconnecting language change observer.");
        languageChangeObserver.disconnect();
        languageChangeObserver = null;
      }
      return;
    }

    const mainElement = await waitForElement(
      ".MIGAKU-SRS[data-mgk-lang-selected]"
    );
    if (!mainElement) {
      extensionLog("Migaku main element not found, skipping logic.");
      if (languageChangeObserver) {
        extensionLog(
          "Migaku element lost, disconnecting language change observer."
        );
        languageChangeObserver.disconnect();
        languageChangeObserver = null;
      }
      return;
    }

    if (!languageChangeObserver) {
      extensionLog("Setting up language change observer.");
      languageChangeObserver = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === "data-mgk-lang-selected"
          ) {
            const newLanguage = mainElement.getAttribute(
              "data-mgk-lang-selected"
            );
            extensionLog(`Language attribute changed to: ${newLanguage}`);
            if (newLanguage && newLanguage !== selectedLanguage) {
              extensionLog(
                `Detected language change from "${selectedLanguage}" to "${newLanguage}". Rerunning stats logic.`
              );
              runStatsLogic();
            } else if (!newLanguage && selectedLanguage) {
              extensionLog(
                `Language attribute removed. Rerunning stats logic.`
              );
              runStatsLogic();
            }
            break;
          }
        }
      });
      languageChangeObserver.observe(mainElement, {
        attributes: true,
        attributeFilter: ["data-mgk-lang-selected"],
      });
      extensionLog("Language change observer attached.");
    }

    let currentLanguage;
    try {
      currentLanguage = mainElement.attributes.getNamedItem(
        "data-mgk-lang-selected"
      ).value;
      if (currentLanguage !== selectedLanguage) {
        extensionLog("Processing for language:", currentLanguage);
      } else {
        extensionLog("Language unchanged, re-validating stats...");
      }
    } catch (error) {
      extensionLog("Could not read selected language attribute.", error);
      lastWordStats = null;
      lastDueStats = null;
      await displayCustomStats(
        "Error: Could not determine selected language."
      ).catch((e) => extensionLog("Failed to display language error", e));
      isProcessing = false;
      return;
    }

    if (isProcessing && selectedLanguage === currentLanguage) {
      extensionLog(
        "Stats logic already running for the current language, skipping."
      );
      return;
    }

    if (currentLanguage === selectedLanguage && isProcessing) {
      extensionLog(
        `Skipping run: Language (${currentLanguage}) hasn't changed and processing is ongoing.`
      );
      return;
    }
    if (currentLanguage === selectedLanguage && !isProcessing) {
      extensionLog(
        `Language (${currentLanguage}) hasn't changed since last successful run. Checking if stats need refresh.`
      );
    }

    selectedLanguage = currentLanguage;
    isProcessing = true;
    extensionLog("Running stats logic for language:", selectedLanguage);

    try {
      const db = await initDB();
      if (!db) {
        throw new Error("Failed to initialize database connection.");
      }
      await accessMigakuData(db);
    } catch (error) {
      extensionLog("Error in runStatsLogic:", error);
      lastWordStats = null;
      lastDueStats = null;
      await displayCustomStats(
        `Error running stats logic: ${error.message}`
      ).catch((e) => extensionLog("Failed to display run error", e));
    } finally {
      isProcessing = false;
      extensionLog(
        "Stats logic processing finished for language:",
        selectedLanguage
      );
    }
  }

  async function accessMigakuData(db) {
    if (!db.objectStoreNames.contains(objectStoreName)) {
      extensionLog(
        `Object store "${objectStoreName}" not found in database "${dbName}".`
      );
      extensionLog(
        `Available stores: ${Array.from(db.objectStoreNames).join(", ")}`
      );
      await displayCustomStats(
        "Error",
        `Object store '${objectStoreName}' not found.`
      ).catch((e) => extensionLog("Failed to display object store error", e));
      return;
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([objectStoreName], "readonly");
      const objectStore = transaction.objectStore(objectStoreName);
      const getAllRequest = objectStore.getAll();

      transaction.oncomplete = () => {
        extensionLog("Read transaction completed.");
      };

      transaction.onerror = (event) => {
        extensionLog("Read transaction error:", event.target.error);
        displayCustomStats(`Error reading DB: ${event.target.error}`).catch(
          (e) => extensionLog("Failed to display DB read error", e)
        );
        reject(event.target.error);
      };

      getAllRequest.onerror = (event) => {
        extensionLog("Error getting record:", event.target.error);
      };

      getAllRequest.onsuccess = async (event) => {
        try {
          const allRecords = event.target.result;
          extensionLog(
            `Retrieved ${allRecords.length} raw records from ${objectStoreName}.`
          );

          if (
            !allRecords ||
            allRecords.length === 0 ||
            !allRecords[0].data ||
            !(allRecords[0].data instanceof Uint8Array)
          ) {
            extensionLog(
              `Expected record structure not found in ${objectStoreName}. Check the data structure.`
            );
            await displayCustomStats(
              "Error",
              "Could not find SQLite data blob."
            ).catch((e) =>
              extensionLog("Failed to display structure error", e)
            );
            resolve();
            return;
          }

          let dbFileBlob = allRecords[0].data;
          let SQL = null;
          let dbInstance = null;

          try {
            extensionLog(
              "Detected Uint8Array, attempting Gzip decompression..."
            );
            try {
              dbFileBlob = pako.inflate(dbFileBlob);
              extensionLog("Decompression successful.");
            } catch (err) {
              extensionLog("Gzip Decompression failed:", err);
              await displayCustomStats(
                "Error",
                "Gzip decompression failed."
              ).catch((e) =>
                extensionLog("Failed to display decompression error", e)
              );
              resolve();
              return;
            }

            extensionLog("Initializing sql.js...");
            try {
              SQL = await initSqlJs({
                locateFile: (file) =>
                  `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${file}`,
              });
              extensionLog("sql.js initialized successfully.");
            } catch (err) {
              extensionLog("Failed to initialize sql.js:", err);
              await displayCustomStats(
                "Error",
                "Failed to load sql.js engine."
              ).catch((e) =>
                extensionLog("Failed to display sql.js init error", e)
              );
              resolve();
              return;
            }

            extensionLog("Loading database into sql.js...");
            dbInstance = new SQL.Database(dbFileBlob);
            extensionLog("Database loaded successfully.");

            extensionLog("Executing SQL queries...");

            const decksQuery = `
              SELECT id, name 
              FROM deck 
              WHERE lang = ? AND del = 0
              ORDER BY name;
            `;

            try {
              const decksResults = dbInstance.exec(decksQuery, [
                selectedLanguage,
              ]);
              availableDecks = [];

              availableDecks.push({ id: "all", name: "All Decks" });

              if (
                decksResults.length > 0 &&
                decksResults[0].values.length > 0
              ) {
                extensionLog("Decks query results:", decksResults[0]);

                decksResults[0].values.forEach((row) => {
                  const id = String(row[0]);
                  const name = row[1];
                  availableDecks.push({ id, name });
                });

                extensionLog("Available decks:", availableDecks);

                if (selectedDeckId === "all" && availableDecks.length > 1) {
                  selectedDeckId = "all";
                }
              } else {
                extensionLog("No decks found for language:", selectedLanguage);
              }
            } catch (decksError) {
              extensionLog("Error fetching decks:", decksError);
            }

            let wordQuery = `
              SELECT
                  SUM(CASE WHEN knownStatus = 'KNOWN' THEN 1 ELSE 0 END) as known_count,
                  SUM(CASE WHEN knownStatus = 'LEARNING' THEN 1 ELSE 0 END) as learning_count,
                  SUM(CASE WHEN knownStatus = 'UNKNOWN' THEN 1 ELSE 0 END) as unknown_count,
                  SUM(CASE WHEN knownStatus = 'IGNORE' THEN 1 ELSE 0 END) as ignored_count
              FROM WordList
              WHERE language = ? AND del = 0`;

            let wordQueryParams = [selectedLanguage];

            if (selectedDeckId !== "all") {
              wordQuery = `
                SELECT
                    SUM(CASE WHEN w.knownStatus = 'KNOWN' THEN 1 ELSE 0 END) as known_count,
                    SUM(CASE WHEN w.knownStatus = 'LEARNING' THEN 1 ELSE 0 END) as learning_count,
                    SUM(CASE WHEN w.knownStatus = 'UNKNOWN' THEN 1 ELSE 0 END) as unknown_count,
                    SUM(CASE WHEN w.knownStatus = 'IGNORE' THEN 1 ELSE 0 END) as ignored_count
                FROM (
                    SELECT DISTINCT w.dictForm, w.knownStatus
                    FROM WordList w
                    JOIN CardWordRelation cwr ON w.dictForm = cwr.dictForm
                    JOIN card c ON cwr.cardId = c.id
                    JOIN deck d ON c.deckId = d.id
                    WHERE w.language = ? AND w.del = 0 AND d.id = ?
                ) as w`;
              wordQueryParams = [selectedLanguage, selectedDeckId];
            }

            const wordResults = dbInstance.exec(wordQuery, wordQueryParams);
            let wordValues = null;
            if (wordResults.length > 0 && wordResults[0].values.length > 0) {
              extensionLog("Word query results:", wordResults);
              const numberOfResults = wordResults[0].values[0].length;
              wordValues = {};
              for (let i = 0; i < numberOfResults; i++) {
                wordValues[wordResults[0].columns[i]] =
                  wordResults[0].values[0][i];
              }
            } else {
              extensionLog("Word query returned no results.");
              wordValues = null;
            }

            const startDate = new Date(2020, 0, 1);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const todayDayNumber =
              Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;
            const endDayNumber = todayDayNumber + 29;
            extensionLog(
              `Calculating due cards between day ${todayDayNumber} and ${endDayNumber}`
            );

            let dueQuery = `
              SELECT
                due,
                COUNT(*) as count
              FROM card c
              JOIN card_type ct ON c.cardTypeId = ct.id
              WHERE ct.lang = ? AND c.due BETWEEN ? AND ?
            `;

            let dueQueryParams = [
              selectedLanguage,
              todayDayNumber,
              endDayNumber,
            ];

            if (selectedDeckId !== "all") {
              dueQuery += " AND c.deckId = ?";
              dueQueryParams.push(selectedDeckId);
            }

            dueQuery += " GROUP BY due ORDER BY due";

            const dueResults = dbInstance.exec(dueQuery, dueQueryParams);
            let dueData = null;

            if (dueResults.length > 0 && dueResults[0].values.length > 0) {
              extensionLog("Due cards query results:", dueResults[0]);
              const dueCountsByDay = {};
              dueResults[0].values.forEach((row) => {
                const resultRow = {};
                dueResults[0].columns.forEach((col, index) => {
                  resultRow[col] = row[index];
                });
                dueCountsByDay[resultRow.due] = resultRow.count;
              });

              const dateLabels = [];
              const dateCounts = [];
              const tempDate = new Date(today);

              for (let i = 0; i < 30; i++) {
                const dayNum = todayDayNumber + i;
                const label = tempDate.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                });
                dateLabels.push(label);
                dateCounts.push(dueCountsByDay[dayNum] || 0);
                tempDate.setDate(tempDate.getDate() + 1);
              }
              dueData = { labels: dateLabels, counts: dateCounts };
            } else {
              extensionLog("Due cards query returned no results.");
              const dateLabels = [];
              const dateCounts = [];
              const tempDate = new Date(today);
              for (let i = 0; i < 30; i++) {
                const label = tempDate.toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                });
                dateLabels.push(label);
                dateCounts.push(0);
                tempDate.setDate(tempDate.getDate() + 1);
              }
              dueData = { labels: dateLabels, counts: dateCounts };
            }

            lastWordStats = wordValues;
            lastDueStats = dueData;

            if (wordValues || (dueData && dueData.labels.length > 0)) {
              await displayCustomStats({
                wordStats: wordValues,
                dueStats: dueData,
              });
            } else {
              extensionLog(
                "Both queries returned no usable data. Displaying message."
              );
              await displayCustomStats(
                "Info: No word or due card data found for this language."
              );
            }
          } catch (error) {
            extensionLog("Error during SQL execution/processing:", error);
            lastWordStats = null;
            lastDueStats = null;
            await displayCustomStats(`Processing error: ${error.message}`);
          } finally {
            if (dbInstance) {
              extensionLog("Closing SQL.js database instance.");
              dbInstance.close();
            }
            resolve();
          }
        } catch (outerError) {
          extensionLog("Error in getAllRequest.onsuccess:", outerError);
          lastWordStats = null;
          lastDueStats = null;
          await displayCustomStats(
            `Internal script error: ${outerError.message}`
          );
          resolve();
        }
      };
    });
  }

  async function displayCustomStats(data) {
    extensionLog("Preparing to display stats...");
    const themeColors = getThemeColors();
    migakuTooltip.backgroundColor = themeColors.tooltipBg;
    migakuTooltip.titleColor = themeColors.textColor;
    migakuTooltip.bodyColor = themeColors.textColor;

    const statisticsDiv = await waitForElement(statisticsElementSelector);
    if (!statisticsDiv) {
      extensionLog("Statistics element not found, cannot display stats.");
      return;
    }

    const componentHash = statisticsDiv.attributes[0].nodeName;

    const statsContainer = await waitForElement(targetElementSelector);
    if (!statsContainer) {
      extensionLog("Target container not found, cannot display stats.");
      return;
    }
    extensionLog(
      "Target element confirmed for display:",
      targetElementSelector
    );

    const oldStatsDiv = statsContainer.querySelector("#migaku-custom-stats");
    if (oldStatsDiv) oldStatsDiv.remove();
    const oldErrorDiv = statsContainer.querySelector(
      "#migaku-custom-stats-error"
    );
    if (oldErrorDiv) oldErrorDiv.remove();

    const isError = typeof data === "string" || data instanceof Error;
    let wordStats = null;
    let dueStats = null;
    let message = "";

    if (isError) {
      message = data instanceof Error ? `Error: ${data.message}` : data;
      extensionLog(`Displaying message: ${message}`);
      if (!(data && data.hasOwnProperty("wordStats"))) {
        lastWordStats = null;
        lastDueStats = null;
      }
    } else if (data && (data.wordStats || data.dueStats)) {
      wordStats = data.wordStats;
      dueStats = data.dueStats;
      if (data !== lastWordStats) {
        lastWordStats = wordStats;
        lastDueStats = dueStats;
      }
      extensionLog("Displaying data:", { wordStats, dueStats });
    } else {
      message = "Loading stats or no data available...";
      extensionLog(message);
      lastWordStats = null;
      lastDueStats = null;
    }

    const statsDiv = document.createElement("div");
    statsDiv.id =
      isError || message
        ? "migaku-custom-stats-message"
        : "migaku-custom-stats";
    statsDiv.classList.add("MCS__container");

    const selectedDeckName =
      availableDecks.find((d) => d.id === selectedDeckId)?.name || "All Decks";

    if (isError || message) {
      statsDiv.classList.add("UiCard", "-lesson", "Statistic__card");
      const title = isError
        ? "Migaku Custom Stats - Error"
        : "Migaku Custom Stats - Info";
      statsDiv.innerHTML = `
            <div ${componentHash} class="Statistic__card__header">
                <h3 ${componentHash} class="UiTypo UiTypo__heading3 -heading">${title}</h3>
            </div>
            <div ${componentHash} class="MCS__message">
                <span ${componentHash} class="UiTypo UiTypo__body1">${message}</span>
            </div>
        `;
    } else {
      const wordStatsHTML = wordStats
        ? `
            <div ${componentHash} class="MCS__word-stats-card">
                <div ${componentHash} class="Statistic__card__header">
                    <h3 ${componentHash} class="UiTypo UiTypo__heading3 -heading">Word Status - ${selectedDeckName}</h3>
                </div>
                <div ${componentHash} class="MCS__wordcount">
                    <div ${componentHash} class="MCS__wordcount__details">
                        <div ${componentHash}>
                            <span class="UiTypo UiTypo__caption">Known:</span> <span class="UiTypo UiTypo__heading4 -heading -inline">${
                              wordStats.known_count ?? "N/A"
                            }</span>
                        </div>
                        <div ${componentHash}>
                            <span class="UiTypo UiTypo__caption">Learning:</span> <span class="UiTypo UiTypo__heading4 -heading -inline">${
                              wordStats.learning_count ?? "N/A"
                            }</span>
                        </div>
                        <div ${componentHash}>
                            <span class="UiTypo UiTypo__caption">Unknown:</span> <span class="UiTypo UiTypo__heading4 -heading -inline">${
                              wordStats.unknown_count ?? "N/A"
                            }</span>
                        </div>
                        <div ${componentHash}>
                            <span class="UiTypo UiTypo__caption">Ignored:</span> <span class="UiTypo UiTypo__heading4 -heading -inline">${
                              wordStats.ignored_count ?? "N/A"
                            }</span>
                        </div>
                    </div>
                    <div ${componentHash} class="MCS__wordcount__piechart">
                        <canvas id="mcsWordDoughnutChart"></canvas>
                    </div>
                </div>
            </div>
        `
        : `
            <div ${componentHash} class="MCS__word-stats-card">
                    <div ${componentHash} class="Statistic__card__header">
                    <h3 ${componentHash} class="UiTypo UiTypo__heading3 -heading">Word Status</h3>
                </div>
                <p ${componentHash} class="UiTypo UiTypo__body2">Could not load word status data.</p>
            </div>
        `;

      const dueStatsHTML =
        dueStats && dueStats.labels && dueStats.counts
          ? `
            <div ${componentHash} class="MCS__due-stats-card">
                <div ${componentHash} class="Statistic__card__header">
                    <h3 ${componentHash} class="UiTypo UiTypo__heading3 -heading">Cards Due (Next 30 Days) - ${selectedDeckName}</h3>
                </div>
                <div ${componentHash} class="MCS__duechart">
                    <canvas id="mcsDueBarChart"></canvas>
                </div>
            </div>
        `
          : `
            <div ${componentHash} class="MCS__due-stats-card">
                <div ${componentHash} class="Statistic__card__header">
                <h3 ${componentHash} class="UiTypo UiTypo__heading3 -heading">Cards Due (Next 30 Days)</h3>
            </div>
            <p ${componentHash} class="UiTypo UiTypo__body2">Could not load due card data.</p>
        </div>
    `;

      const checkmarkIcon = (id) => {
        return `
        <div class="UiIcon multiselect__checkIcon" style="width: 24px;">
          <div class="UiIcon__inner">
            <div class="UiSvg UiIcon__svg" name="Check" gradient="true" spin="false">
              <div class="UiSvg__inner UiIcon__gradient" style="clip-path: url('#${id}');">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" role="img">
                  <defs>
                    <clipPath id="${id}" data-dont-prefix-id="" transform="scale(1)">
                      <path fill="currentColor" fill-rule="evenodd" d="M19.83 7.066a1.25 1.25 0 0 1 .104 1.764l-8 9a1.25 1.25 0 0 1-1.818.054l-5-5a1.25 1.25 0 0 1 1.768-1.768l4.063 4.063 7.119-8.01a1.25 1.25 0 0 1 1.765-.103" clip-rule="evenodd">
                      </path>
                    </clipPath>
                  </defs>
                </svg>
              </div>
            </div>
          </div>
        </div>
      `;
      };

      let dropdownOptionsHTML = "";
      availableDecks.forEach((deck) => {
        const isSelected = selectedDeckId === deck.id;
        dropdownOptionsHTML += `
        <li class="multiselect__element" role="option">
          <span class="multiselect__option ${
            isSelected
              ? "multiselect__option--highlight multiselect__option--selected"
              : ""
          }" data-value="${deck.id}">
            <div class="multiselect__optionWrapper" style="width: 120px;">
              <span class="UiTypo UiTypo__caption ${
                isSelected ? "-emphasis" : ""
              } multiselect__optionWrapper__text">${deck.name}</span>
              <div style="display: ${isSelected ? "block" : "none"};"> 
                ${checkmarkIcon(deck.id)}
              </div>
            </div>
          </span>
        </li>
      `;
      });

      const startHTML = `
            <h2 ${componentHash} class="UiTypo UiTypo__heading2 -heading Statistic__title">Migaku Custom Stats</h2>
            <div ${componentHash} class="UiCard -lesson Statistic__card">
              <div ${componentHash} class="MCS__deck-selector UiFormField SettingsGeneral__optionLeft">
                <div class="UiFormField__labelContainer">
                  <label ${componentHash} class="UiTypo UiTypo__body UiFormField__labelContainer__typo">Deck</label>
                </div>
                <div class="UiFormField__controlContainer">
                  <div tabindex="0" id="mcs-dropdown" class="multiselect multiselect--right -has-value" role="combobox" aria-owns="listbox-mcs-dropdown" style="width: 160px;">
                    <div class="UiIcon multiselect__caret" style="width: 24px;"><div class="UiIcon__inner"><div class="UiSvg UiIcon__svg" name="ChevronDownSmall" gradient="false" spin="false"><div class="UiSvg__inner">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" role="img">
                      <path fill="currentColor" fill-rule="evenodd" d="M7.116 10.116a1.25 1.25 0 0 1 1.768 0L12 13.232l3.116-3.116a1.25 1.25 0 0 1 1.768 1.768l-4 4a1.25 1.25 0 0 1-1.768 0l-4-4a1.25 1.25 0 0 1 0-1.768" clip-rule="evenodd"></path>
                    </svg>
                    </div></div></div></div>
                    <div class="multiselect__tags">
                      <div class="multiselect__tags-wrap" style="display: none;"></div>
                      <div class="multiselect__spinner" style="display: none;"></div>
                      <span class="multiselect__single"><span class="UiTypo UiTypo__caption -no-wrap multiselect__single__text" data-value="${selectedDeckId}">${selectedDeckName}</span></span>
                    </div>
                    <div class="multiselect__content-wrapper" tabindex="-1" style="max-height: 300px; display: none;">
                      <ul class="multiselect__content" role="listbox" id="listbox-mcs-dropdown" style="display: inline-block;">
                        ${dropdownOptionsHTML}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
        `;

      const endHTML = `
        </div>
      `;

      statsDiv.innerHTML = startHTML + wordStatsHTML + dueStatsHTML + endHTML;
    }

    statsContainer.appendChild(statsDiv);
    extensionLog("Successfully appended/updated custom stats element(s).");

    setupDropdown();

    if (!isError && !message) {
      if (wordStats) {
        const doughnutChartCanvas = document.getElementById(
          "mcsWordDoughnutChart"
        );
        if (doughnutChartCanvas) {
          const doughnutChartCtx = doughnutChartCanvas.getContext("2d");
          if (doughnutChartCtx) {
            extensionLog(
              "Creating doughnut chart with theme:",
              getCurrentTheme()
            );
            try {
              wordChartInstance = new Chart(doughnutChartCtx, {
                type: "doughnut",
                data: {
                  labels: ["Known", "Learning", "Unknown", "Ignored"],
                  datasets: [
                    {
                      label: "Word Status Distribution",
                      data: [
                        wordStats.known_count || 0,
                        wordStats.learning_count || 0,
                        wordStats.unknown_count || 0,
                        wordStats.ignored_count || 0,
                      ],
                      backgroundColor: [
                        themeColors.knownColor,
                        themeColors.learningColor,
                        themeColors.unknownColor,
                        themeColors.ignoredColor,
                      ],
                      borderWidth: 0,
                    },
                  ],
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      position: "right",
                      labels: {
                        boxWidth: 20,
                        color: themeColors.textColor,
                      },
                    },
                    title: { display: false },
                    tooltip: {
                      callbacks: {
                        label: function (context) {
                          let label = context.label || "";
                          if (label) {
                            label += ": ";
                          }
                          if (context.parsed !== null) {
                            label += context.parsed.toLocaleString();
                          }
                          return label;
                        },
                      },
                      ...migakuTooltip,
                    },
                  },
                },
              });
              extensionLog("Doughnut chart created successfully.");
            } catch (chartError) {
              extensionLog(
                "Error creating Doughnut Chart instance:",
                chartError
              );
              doughnutChartCanvas.parentElement.innerHTML =
                '<p class="UiTypo UiTypo__body2">Error rendering word status chart.</p>';
            }
          } else {
            extensionLog("Could not get 2D context for doughnut chart canvas.");
            doughnutChartCanvas.parentElement.innerHTML =
              '<p class="UiTypo UiTypo__body2">Failed to get doughnut chart context.</p>';
          }
        } else {
          extensionLog(
            "Could not find canvas element with ID 'mcsWordDoughnutChart'."
          );
          const chartContainer = statsDiv.querySelector(
            ".MCS__wordcount__piechart"
          );
          if (chartContainer) {
            chartContainer.innerHTML =
              '<p class="UiTypo UiTypo__body2">Word chart canvas not found.</p>';
          }
        }
      } else {
        extensionLog("No word stats data for doughnut chart.");
      }

      if (dueStats && dueStats.labels && dueStats.counts) {
        const barChartCanvas = document.getElementById("mcsDueBarChart");
        if (barChartCanvas) {
          const barChartCtx = barChartCanvas.getContext("2d");
          if (barChartCtx) {
            extensionLog("Creating bar chart with theme:", getCurrentTheme());
            try {
              dueChartInstance = new Chart(barChartCtx, {
                type: "bar",
                data: {
                  labels: dueStats.labels,
                  datasets: [
                    {
                      label: "Cards Due",
                      data: dueStats.counts,
                      backgroundColor: themeColors.barColor,
                      borderWidth: 0,
                      borderRadius: 4,
                    },
                  ],
                },
                options: {
                  responsive: true,
                  maintainAspectRatio: false,
                  scales: {
                    y: {
                      beginAtZero: true,
                      ticks: {
                        color: themeColors.textColor,
                        precision: 0,
                      },
                      grid: {
                        color: themeColors.gridColor,
                      },
                    },
                    x: {
                      ticks: {
                        color: themeColors.textColor,
                        maxRotation: 45,
                        minRotation: 45,
                      },
                      grid: { display: false },
                    },
                  },
                  plugins: {
                    legend: { display: false },
                    title: { display: false },
                    tooltip: {
                      callbacks: {
                        label: function (context) {
                          let label = context.dataset.label || "";
                          if (label) {
                            label += ": ";
                          }
                          if (context.parsed.y !== null) {
                            label += context.parsed.y.toLocaleString();
                          }
                          return label;
                        },
                      },
                      ...migakuTooltip,
                    },
                  },
                },
              });
              extensionLog("Bar chart created successfully.");
            } catch (chartError) {
              extensionLog("Error creating Bar Chart instance:", chartError);
              barChartCanvas.parentElement.innerHTML =
                '<p class="UiTypo UiTypo__body2">Error rendering due card chart.</p>';
            }
          } else {
            extensionLog("Could not get 2D context for bar chart canvas.");
            barChartCanvas.parentElement.innerHTML =
              '<p class="UiTypo UiTypo__body2">Failed to get bar chart context.</p>';
          }
        } else {
          extensionLog(
            "Could not find canvas element with ID 'mcsDueBarChart'."
          );
          const chartContainer = statsDiv.querySelector(".MCS__duechart");
          if (chartContainer) {
            chartContainer.innerHTML =
              '<p class="UiTypo UiTypo__body2">Due card chart canvas not found.</p>';
          }
        }
      } else {
        extensionLog("No due stats data for bar chart.");
      }
    }
  }

  function setupDropdown() {
    const dropdown = document.getElementById("mcs-dropdown");
    if (!dropdown) {
      extensionLog("Dropdown element not found");
      return;
    }

    const contentWrapper = dropdown.querySelector(
      ".multiselect__content-wrapper"
    );
    const singleText = dropdown.querySelector(".multiselect__single__text");

    dropdown.addEventListener("click", function (e) {
      e.stopPropagation();

      const isDisplayed = contentWrapper.style.display !== "none";
      if (isDisplayed) {
        contentWrapper.style.display = "none";
        dropdown.classList.remove("multiselect--active");
      } else {
        contentWrapper.style.display = "block";
        dropdown.classList.add("multiselect--active");
      }
    });

    document.addEventListener("click", function () {
      if (contentWrapper && contentWrapper.style.display !== "none") {
        contentWrapper.style.display = "none";
        dropdown.classList.remove("multiselect--active");
      }
    });

    const options = dropdown.querySelectorAll(".multiselect__option");
    options.forEach((option) => {
      option.addEventListener("click", function (e) {
        e.stopPropagation();

        const value = this.getAttribute("data-value");
        if (!value) {
          extensionLog("Selected option has no data-value attribute");
          return;
        }

        extensionLog(`Selected deck: ${value}`);

        if (selectedDeckId === value) {
          contentWrapper.style.display = "none";
          dropdown.classList.remove("multiselect--active");
          return;
        }

        selectedDeckId = value;

        contentWrapper.style.display = "none";
        dropdown.classList.remove("multiselect--active");

        runFilteredStatsQuery();
      });
    });
  }

  function runFilteredStatsQuery() {
    const selectedDeck = availableDecks.find((d) => d.id == selectedDeckId);
    const deckName = selectedDeck ? selectedDeck.name : "All Decks";
    extensionLog(
      `Refreshing data for deck: ${deckName} (ID: ${selectedDeckId})`
    );

    if (isProcessing) {
      extensionLog("Stats refresh already in progress, skipping.");
      return;
    }

    isProcessing = true;

    const existingDueChartCanvas = document.getElementById("mcsDueBarChart");
    if (existingDueChartCanvas && existingDueChartCanvas.parentElement) {
      existingDueChartCanvas.parentElement.innerHTML = `
        <p class="UiTypo UiTypo__body2">Loading due cards data for ${deckName}...</p>
      `;
    }

    const existingWordChartCanvas = document.getElementById(
      "mcsWordDoughnutChart"
    );
    if (existingWordChartCanvas && existingWordChartCanvas.parentElement) {
      existingWordChartCanvas.parentElement.innerHTML = `
        <p class="UiTypo UiTypo__body2">Loading word data for ${deckName}...</p>
      `;
    }

    if (wordChartInstance) {
      wordChartInstance.destroy();
      wordChartInstance = null;
    }

    if (dueChartInstance) {
      dueChartInstance.destroy();
      dueChartInstance = null;
    }

    initDB()
      .then((db) => {
        return accessMigakuData(db);
      })
      .catch((err) => {
        extensionLog("Error refreshing data:", err);
        displayCustomStats(`Error refreshing data: ${err.message}`);
      })
      .finally(() => {
        isProcessing = false;
      });
  }

  function setupThemeObserver() {
    if (themeChangeObserver) {
      extensionLog("Theme observer already exists.");
      return;
    }
    const htmlElement = document.documentElement;
    if (!htmlElement) {
      extensionLog("HTML element not found, cannot set up theme observer.");
      return;
    }

    extensionLog("Setting up theme change observer.");
    themeChangeObserver = new MutationObserver((mutationsList) => {
      for (const mutation of mutationsList) {
        if (
          mutation.type === "attributes" &&
          mutation.attributeName === "data-mgk-theme"
        ) {
          const newTheme = htmlElement.getAttribute("data-mgk-theme") || "dark";
          extensionLog(
            `Theme attribute changed to: ${newTheme}. Refreshing charts.`
          );
          if (lastWordStats || lastDueStats) {
            displayCustomStats({
              wordStats: lastWordStats,
              dueStats: lastDueStats,
            }).catch((e) =>
              extensionLog("Error refreshing charts on theme change:", e)
            );
          } else {
            extensionLog(
              "No cached data available to refresh charts for new theme."
            );
          }
          break;
        }
      }
    });

    themeChangeObserver.observe(htmlElement, {
      attributes: true,
      attributeFilter: ["data-mgk-theme"],
    });
    extensionLog(
      `Initial theme detected: ${getCurrentTheme()}. Observer attached.`
    );
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function () {
    const result = originalPushState.apply(this, arguments);
    extensionLog("pushState called, triggering URL check.");
    setTimeout(runStatsLogic, 0);
    return result;
  };

  history.replaceState = function () {
    const result = originalReplaceState.apply(this, arguments);
    extensionLog("replaceState called, triggering URL check.");
    setTimeout(runStatsLogic, 0);
    return result;
  };

  window.addEventListener("popstate", () => {
    extensionLog("popstate event detected, triggering URL check.");
    runStatsLogic();
  });

  extensionLog("Migaku Custom Stats Script Initializing...");
  runStatsLogic();
  setupThemeObserver();
})();
