// ==UserScript==
// @name         Migaku Custom Stats
// @namespace    http://tampermonkey.net/
// @version      0.0.4
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
    `;

  const migakuTooltip = {
    backgroundColor: "#2b2b60",
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

    const mainElement = await waitForElement(".MIGAKU-SRS[data-mgk-lang-selected]");
    if (!mainElement) {
      extensionLog("Migaku main element not found, skipping logic.");
      if (languageChangeObserver) {
        extensionLog("Migaku element lost, disconnecting language change observer.");
        languageChangeObserver.disconnect();
        languageChangeObserver = null;
      }
      return;
    }

    if (!languageChangeObserver) {
      extensionLog("Setting up language change observer.");
      languageChangeObserver = new MutationObserver((mutationsList) => {
        for(const mutation of mutationsList) {
          if (mutation.type === 'attributes' && mutation.attributeName === 'data-mgk-lang-selected') {
            const newLanguage = mainElement.getAttribute('data-mgk-lang-selected');
            extensionLog(`Language attribute changed to: ${newLanguage}`);
            if (newLanguage && newLanguage !== selectedLanguage) {
              extensionLog(`Detected language change from "${selectedLanguage}" to "${newLanguage}". Rerunning stats logic.`);
              runStatsLogic();
            } else if (!newLanguage && selectedLanguage) {
              extensionLog(`Language attribute removed. Rerunning stats logic.`);
              runStatsLogic();
            }
            break;
          }
        }
      });
      languageChangeObserver.observe(mainElement, { attributes: true, attributeFilter: ['data-mgk-lang-selected'] });
      extensionLog("Language change observer attached.");
    }

    let currentLanguage;
    try {
      currentLanguage = mainElement.attributes.getNamedItem("data-mgk-lang-selected").value;
      if (currentLanguage !== selectedLanguage) {
        extensionLog("Processing for language:", currentLanguage);
      } else {
        extensionLog("Language unchanged, re-validating stats...");
      }
    } catch (error) {
      extensionLog("Could not read selected language attribute.", error);
      await displayCustomStats("Error: Could not determine selected language.").catch(e => extensionLog("Failed to display language error", e));
      isProcessing = false;
      return;
    }

    if (isProcessing && selectedLanguage === currentLanguage) {
      extensionLog("Stats logic already running for the current language, skipping.");
      return;
    }

    if (currentLanguage === selectedLanguage && isProcessing) {
      extensionLog(`Skipping run: Language (${currentLanguage}) hasn't changed and processing is ongoing.`);
      return;
    }
    if (currentLanguage === selectedLanguage && !isProcessing) {
      extensionLog(`Language (${currentLanguage}) hasn't changed since last successful run. Checking if stats need refresh.`);
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
      await displayCustomStats(
        `Error running stats logic: ${error.message}`
      ).catch((e) => extensionLog("Failed to display run error", e));
    } finally {
      isProcessing = false;
      extensionLog("Stats logic processing finished for language:", selectedLanguage);
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

            const wordQuery = `
                    SELECT
                        SUM(CASE WHEN knownStatus = 'KNOWN' THEN 1 ELSE 0 END) as known_count,
                        SUM(CASE WHEN knownStatus = 'LEARNING' THEN 1 ELSE 0 END) as learning_count,
                        SUM(CASE WHEN knownStatus = 'UNKNOWN' THEN 1 ELSE 0 END) as unknown_count,
                        SUM(CASE WHEN knownStatus = 'IGNORE' THEN 1 ELSE 0 END) as ignored_count
                    FROM WordList
                    WHERE language = ? AND del = 0;`;
            const wordResults = dbInstance.exec(wordQuery, [selectedLanguage]);
            let wordValues = {};
            if (wordResults.length > 0 && wordResults[0].values.length > 0) {
              extensionLog("Word query results:", wordResults);
              const numberOfResults = wordResults[0].values[0].length;
              for (let i = 0; i < numberOfResults; i++) {
                wordValues[wordResults[0].columns[i]] =
                  wordResults[0].values[0][i];
              }
            } else {
              extensionLog(
                "Word query executed, but returned no result sets or rows."
              );
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

            const dueQuery = `
              SELECT
                due,
                COUNT(*) as count
              FROM card c
              JOIN card_type ct ON c.cardTypeId = ct.id
              WHERE ct.lang = ? AND c.due BETWEEN ? AND ?
              GROUP BY due
              ORDER BY due;
            `;

            const dueResults = dbInstance.exec(dueQuery, [
              selectedLanguage,
              todayDayNumber,
              endDayNumber,
            ]);
            let dueData = { labels: [], counts: [] };

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
              extensionLog(
                "Due cards query executed, but returned no results or rows for the next 30 days."
              );
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

            if (wordValues || dueData) {
              await displayCustomStats({
                wordStats: wordValues,
                dueStats: dueData,
              }).catch((e) =>
                extensionLog("Failed to display custom stats", e)
              );
            } else {
              extensionLog(
                "Both queries returned no data. Nothing to display."
              );
              await displayCustomStats(
                "Error",
                "Could not retrieve word or due card data."
              ).catch((e) =>
                extensionLog("Failed to display query error state", e)
              );
            }
          } catch (error) {
            extensionLog(
              "Error during data processing or SQL execution:",
              error
            );
            await displayCustomStats(
              `Processing error: ${error.message}`
            ).catch((e) =>
              extensionLog("Failed to display processing error", e)
            );
          } finally {
            if (dbInstance) {
              extensionLog("Closing SQL.js database instance.");
              dbInstance.close();
            }
            resolve();
          }
        } catch (outerError) {
          extensionLog("Error in getAllRequest.onsuccess:", outerError);
          await displayCustomStats(
            `Internal script error: ${outerError.message}`
          ).catch((e) => extensionLog("Failed to display internal error", e));
          resolve();
        }
      };
    });
  }

  async function displayCustomStats(data) {
    extensionLog("Preparing to display stats...");

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
    let errorMessage = "An unknown error occurred.";

    if (isError) {
      errorMessage = data instanceof Error ? data.message : data;
      extensionLog(`Displaying error: ${errorMessage}`);
    } else {
      wordStats = data.wordStats;
      dueStats = data.dueStats;
      extensionLog("Received data:", data);
    }

    const statsDiv = document.createElement("div");
    statsDiv.id = isError ? "migaku-custom-stats-error" : "migaku-custom-stats";
    statsDiv.classList.add("MCS__container");

    if (isError) {
      statsDiv.classList.add("UiCard", "-lesson", "Statistic__card");
      statsDiv.innerHTML = `
            <div ${componentHash} class="Statistic__card__header">
                <h3 ${componentHash} class="UiTypo UiTypo__heading3 -heading">Migaku Custom Stats - Error</h3>
            </div>
            <div ${componentHash} class="MCS__error">
                <span ${componentHash} class="UiTypo UiTypo__body1">${errorMessage}</span>
            </div>
        `;
    } else {
      const wordStatsHTML = wordStats
        ? `
            <div ${componentHash} class="MCS__word-stats-card">
                <div ${componentHash} class="Statistic__card__header">
                    <h3 ${componentHash} class="UiTypo UiTypo__heading3 -heading">Word Status</h3>
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
                    <h3 ${componentHash} class="UiTypo UiTypo__heading3 -heading">Cards Due (Next 30 Days)</h3>
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

      const startHTML = `
            <h2 ${componentHash} class="UiTypo UiTypo__heading2 -heading Statistic__title">Migaku Custom Stats</h2>
            <div ${componentHash} class="UiCard -lesson Statistic__card">
        `;
      const endHTML = `
            </div>
        `;

      statsDiv.innerHTML = startHTML + wordStatsHTML + dueStatsHTML + endHTML;
    }

    statsContainer.appendChild(statsDiv);
    extensionLog("Successfully appended/updated custom stats element(s).");

    if (!isError) {
      // Initialize Doughnut Chart
      if (wordStats) {
        const doughnutChartCanvas = document.getElementById(
          "mcsWordDoughnutChart"
        );
        if (doughnutChartCanvas) {
          const doughnutChartCtx = doughnutChartCanvas.getContext("2d");
          if (doughnutChartCtx) {
            extensionLog("Creating doughnut chart...");
            try {
              new Chart(doughnutChartCtx, {
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
                        "rgba(0, 199, 164, 1)", // Known
                        "rgba(0, 199, 164, 0.4)", // Learning
                        "rgba(255, 255, 255, 0.12)", // Unknown
                        "rgba(255, 255, 255, 0.35)", // Ignored
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
                        color: "rgba(255, 255, 255, 1)",
                      },
                    },
                    title: {
                      display: false,
                    },
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
        extensionLog("No word stats data to create doughnut chart.");
      }

      // Initialize Bar Chart
      if (dueStats && dueStats.labels && dueStats.counts) {
        const barChartCanvas = document.getElementById("mcsDueBarChart");
        if (barChartCanvas) {
          const barChartCtx = barChartCanvas.getContext("2d");
          if (barChartCtx) {
            extensionLog("Creating bar chart for due cards...");
            try {
              new Chart(barChartCtx, {
                type: "bar",
                data: {
                  labels: dueStats.labels,
                  datasets: [
                    {
                      label: "Cards Due",
                      data: dueStats.counts,
                      backgroundColor: "rgba(0, 199, 164, 1)",
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
                        color: "rgba(255, 255, 255, 1)",
                        precision: 0,
                      },
                      grid: {
                        color: "rgba(255, 255, 255, 0.1)",
                      },
                    },
                    x: {
                      ticks: {
                        color: "rgba(255, 255, 255, 1)",
                        maxRotation: 45,
                        minRotation: 45,
                      },
                      grid: {
                        display: false,
                      },
                    },
                  },
                  plugins: {
                    legend: {
                      display: false,
                    },
                    title: {
                      display: false,
                    },
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
        extensionLog("No due stats data to create bar chart.");
      }
    }
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
})();
