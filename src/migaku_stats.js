// ==UserScript==
// @name         Migaku Custom Stats
// @namespace    http://tampermonkey.net/
// @version      0.1.2
// @description  Custom stats for Migaku Memory.
// @author       sguadalupe
// @match        https://study.migaku.com
// @match        https://study.migaku.com/statistic
// @match        https://study.migaku.com/collection
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js
// @require      https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js
// @require      https://cdn.jsdelivr.net/npm/vue@3.4.21/dist/vue.global.min.js
// @grant        GM_addStyle
// ==/UserScript==

/* global pako, initSqlJs, Chart, Vue */

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

(function () {
  "use strict";

  // =========================================================================
  // Constants and Configuration
  // =========================================================================

  // Environment and debug settings
  const SETTINGS = {
    ENVIRONMENT: "prod",
    DEFAULT_TIMEOUT: 15000,
    DEFAULT_DECK_ID: "all"
  };

  // Database configuration
  const DB_CONFIG = {
    DB_NAME: "srs",
    OBJECT_STORE: "data",
    SQL_CDN_PATH: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/"
  };

  // Selectors for DOM elements
  const SELECTORS = {
    STATISTICS_ELEMENT: ".Statistic",
    TARGET_ELEMENT: ".UiPageLayout",
    MIGAKU_MAIN: ".MIGAKU-SRS[data-mgk-lang-selected]",
    VUE_CONTAINER_ID: "migaku-custom-stats-vue-container",
    LEGACY_CONTAINER_ID: "migaku-custom-stats",
    ERROR_CONTAINER_ID: "migaku-custom-stats-error"
  };

  // Routes and navigation
  const ROUTES = {
    STATS_ROUTE: "/statistic"
  };

  // Attribute names
  const ATTRIBUTES = {
    LANG_SELECTED: "data-mgk-lang-selected",
    THEME: "data-mgk-theme" 
  };

  // Word status values
  const WORD_STATUS = {
    KNOWN: "KNOWN",
    LEARNING: "LEARNING",
    UNKNOWN: "UNKNOWN",
    IGNORED: "IGNORE"
  };

  // Chart configuration
  const CHART_CONFIG = {
    FORECAST_DAYS: 30,
    START_YEAR: 2020,
    START_MONTH: 0,
    START_DAY: 1,
    CHART_LABELS: {
      KNOWN: "Known",
      LEARNING: "Learning",
      UNKNOWN: "Unknown",
      IGNORED: "Ignored"
    },
    TOOLTIP_CONFIG: {
      CORNER_RADIUS: 20,
      PADDING: 12,
      CARET_SIZE: 0,
      BOX_PADDING: 4,
    },
    CHART_CDN_PATH: "https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js",
    ANIMATION_DELAY: 250
  };

  // SQL Queries
  const SQL_QUERIES = {
    DECKS_QUERY: `
      SELECT id, name 
      FROM deck 
      WHERE lang = ? AND del = 0
      ORDER BY name;
    `,
    WORD_QUERY: `
      SELECT
          SUM(CASE WHEN knownStatus = '${WORD_STATUS.KNOWN}' THEN 1 ELSE 0 END) as known_count,
          SUM(CASE WHEN knownStatus = '${WORD_STATUS.LEARNING}' THEN 1 ELSE 0 END) as learning_count,
          SUM(CASE WHEN knownStatus = '${WORD_STATUS.UNKNOWN}' THEN 1 ELSE 0 END) as unknown_count,
          SUM(CASE WHEN knownStatus = '${WORD_STATUS.IGNORED}' THEN 1 ELSE 0 END) as ignored_count
      FROM WordList
      WHERE language = ? AND del = 0`,
    WORD_QUERY_WITH_DECK: `
      SELECT
          SUM(CASE WHEN w.knownStatus = '${WORD_STATUS.KNOWN}' THEN 1 ELSE 0 END) as known_count,
          SUM(CASE WHEN w.knownStatus = '${WORD_STATUS.LEARNING}' THEN 1 ELSE 0 END) as learning_count,
          SUM(CASE WHEN w.knownStatus = '${WORD_STATUS.UNKNOWN}' THEN 1 ELSE 0 END) as unknown_count,
          SUM(CASE WHEN w.knownStatus = '${WORD_STATUS.IGNORED}' THEN 1 ELSE 0 END) as ignored_count
      FROM (
          SELECT DISTINCT w.dictForm, w.knownStatus
          FROM WordList w
          JOIN CardWordRelation cwr ON w.dictForm = cwr.dictForm
          JOIN card c ON cwr.cardId = c.id
          JOIN deck d ON c.deckId = d.id
          WHERE w.language = ? AND w.del = 0 AND d.id = ?
      ) as w`,
    DUE_QUERY: `
      SELECT
        due,
        COUNT(*) as count
      FROM card c
      JOIN card_type ct ON c.cardTypeId = ct.id
      WHERE ct.lang = ? AND c.due BETWEEN ? AND ?`,
    INTERVAL_QUERY: `
      SELECT
        interval as interval_group,
        COUNT(*) as count
      FROM card c
      JOIN card_type ct ON c.cardTypeId = ct.id
      WHERE ct.lang = ? AND c.del = 0 AND c.interval > 0
      GROUP BY interval_group
      ORDER BY interval_group`
  };

  // UI/Display texts
  const UI_TEXTS = {
    ALL_DECKS: "All Decks",
    LOADING_MESSAGE: "Loading stats or no data available...",
    NO_DATA_MESSAGE: "Info: No word or due card data found for this language.",
    ERROR_TITLE: "Migaku Custom Stats - Error",
    INFO_TITLE: "Migaku Custom Stats - Info"
  };

  // =========================================================================
  // State Management
  // =========================================================================

  const appState = {
    isProcessing: false,
    selectedLanguage: null,
    languageChangeObserver: null,
    themeChangeObserver: null,
    selectedDeckId: SETTINGS.DEFAULT_DECK_ID,
    previousRoute: window.location.pathname
  };

  const dbState = {
    migakuDB: null,
    lastWordStats: null,
    lastDueStats: null,
    lastIntervalStats: null,
    availableDecks: []
  };

  const chartState = {
    isRenderingWord: false,
    isRenderingDue: false,
    isRenderingInterval: false,
    pendingRenderRequest: null
  };

  unsafeWindow.Vue = Vue;

  if (typeof Chart !== 'undefined' && Chart.defaults) {
    Chart.defaults.responsive = true;
    Chart.defaults.maintainAspectRatio = false;
  }

  const css = `
    .MCS__container {
        margin: 32px 0;
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .MCS__wordcount {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 16px;
    }

    .MCS__wordcount__details {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
    }

    .MCS__duechart {
        height: 300px;
        width: 100%;
        position: relative;
        padding: 8px;
        margin: 8px 0;
    }

    .MCS__intervalchart {
        height: 300px;
        width: 100%;
        position: relative;
        padding: 8px;
        margin: 8px 0;
    }

    .MCS__wordcount__piechart {
        height: 200px;
        width: 200px;
        position: relative;
    }

    .MCS__deck-selector {
        margin: 16px 0;
    }
    
    /* Make sure canvas elements are visible */
    canvas {
        display: block;
        width: 100% !important;
        height: 100% !important;
        position: absolute;
        top: 0;
        left: 0;
    }
    `;

  const themeConfigs = {
    dark: {
      backgroundElevation1: "#202047",
      backgroundElevation2: "#2b2b60",
      accent1: "rgba(178, 114, 255, 1)",
      accent1Transparent: "rgba(178, 114, 255, 0.12)",
      textColor: "rgba(255, 255, 255, 1)",
      gridColor: "rgba(255, 255, 255, 0.1)",
      knownColor: "rgba(0, 199, 164, 1)",
      learningColor: "rgba(0, 199, 164, 0.4)",
      unknownColor: "rgba(255, 255, 255, 0.12)",
      ignoredColor: "rgba(255, 255, 255, 0.35)",
      barColor: "rgba(0, 199, 164, 1)",
    },
    light: {
      backgroundElevation1: "#fff",
      backgroundElevation2: "#fff",
      accent1: "#672fc3",
      accent1LowContrast: "#ede3ff",
      textColor: "rgba(0, 0, 90, 1)",
      gridColor: "rgba(0, 0, 0, 0.1)",
      knownColor: "rgba(0, 199, 164, 1)",
      learningColor: "rgba(0, 199, 164, 0.4)",
      unknownColor: "rgba(0, 0, 90, 0.07)",
      ignoredColor: "rgba(0, 0, 90, 0.15)",
      barColor: "rgba(0, 199, 164, 1)",
    },
  };

  function getCurrentTheme() {
    return document.documentElement.getAttribute(ATTRIBUTES.THEME) || "dark";
  }

  function getThemeColors() {
    const theme = getCurrentTheme();
    return themeConfigs[theme] || themeConfigs.dark;
  }

  // =========================================================================
  // Chart Manager
  // =========================================================================
  
  const ChartManager = {
    wordChartInstance: null,
    dueChartInstance: null,
    intervalChartInstance: null,
    
    resetCharts() {
      this.destroyCharts();
    },
    
    /**
     * Updates or creates a word distribution pie chart
     * @param {HTMLCanvasElement} canvas - The canvas element to render on
     * @param {Object} wordStats - The word statistics data
     * @param {Function} logFn - Logging function
     * @returns {Object|null} - Chart instance or null if failed
     */
    createWordChart(canvas, wordStats, logFn) {
      if (!canvas || !wordStats) {
        logFn("Word chart creation aborted: missing canvas or data");
        return null;
      }
      
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        logFn("Failed to get word chart canvas context");
        return null;
      }
      
      const themeColors = getThemeColors();
      const data = [
        wordStats.known_count || 0,
        wordStats.learning_count || 0,
        wordStats.unknown_count || 0,
        wordStats.ignored_count || 0,
      ];
      
      const chartConfig = {
        type: 'doughnut',
        data: {
          labels: [
            CHART_CONFIG.CHART_LABELS.KNOWN,
            CHART_CONFIG.CHART_LABELS.LEARNING, 
            CHART_CONFIG.CHART_LABELS.UNKNOWN, 
            CHART_CONFIG.CHART_LABELS.IGNORED
          ],
          datasets: [{
            label: 'Word Status Distribution',
            data: data,
            backgroundColor: [
              themeColors.knownColor,
              themeColors.learningColor,
              themeColors.unknownColor,
              themeColors.ignoredColor,
            ],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 800,
            easing: 'easeOutQuart'
          },
          plugins: {
            legend: {
              position: 'right',
              labels: {
                boxWidth: 20,
                color: themeColors.textColor,
              },
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
              backgroundColor: themeColors.backgroundElevation2,
              titleFontColor: themeColors.textColor,
              caretSize: CHART_CONFIG.TOOLTIP_CONFIG.CARET_SIZE,
              padding: CHART_CONFIG.TOOLTIP_CONFIG.PADDING,
              cornerRadius: CHART_CONFIG.TOOLTIP_CONFIG.CORNER_RADIUS,
              boxPadding: CHART_CONFIG.TOOLTIP_CONFIG.BOX_PADDING,
              multiKeyBackground: themeColors.backgroundElevation1,
              bodyColor: themeColors.textColor,
              titleColor: themeColors.textColor,
            }
          },
        }
      };
      
      try {
        if (this.wordChartInstance) {
          logFn("Updating existing word chart with new data");
          
          this.wordChartInstance.data.datasets[0].data = data;
          
          this.wordChartInstance.data.datasets[0].backgroundColor = [
            themeColors.knownColor,
            themeColors.learningColor,
            themeColors.unknownColor,
            themeColors.ignoredColor,
          ];
          
          this.wordChartInstance.options.plugins.legend.labels.color = themeColors.textColor;
          this.wordChartInstance.options.plugins.tooltip.backgroundColor = themeColors.backgroundElevation2;
          this.wordChartInstance.options.plugins.tooltip.bodyColor = themeColors.textColor;
          this.wordChartInstance.options.plugins.tooltip.titleColor = themeColors.textColor;
          
          this.wordChartInstance.update();
          return this.wordChartInstance;
        }
        
        this.wordChartInstance = new Chart(ctx, chartConfig);
        logFn("Word chart created successfully");
        return this.wordChartInstance;
      } catch (error) {
        logFn("Error in word chart creation/update:", error);
        
        try {
          if (this.wordChartInstance) {
            this.wordChartInstance.destroy();
          }
          this.wordChartInstance = new Chart(ctx, chartConfig);
          logFn("Word chart recreated after error");
          return this.wordChartInstance;
        } catch (recreateError) {
          logFn("Failed to recreate word chart:", recreateError);
          return null;
        }
      }
    },
    
    /**
     * Updates or creates a due cards bar chart
     * @param {HTMLCanvasElement} canvas - The canvas element to render on
     * @param {Object} dueStats - The due statistics data
     * @param {Function} logFn - Logging function
     * @returns {Object|null} - Chart instance or null if failed
     */
    createDueChart(canvas, dueStats, logFn) {
      if (!canvas) {
        logFn("Chart creation aborted: canvas is undefined");
        return null;
      }
      
      if (!dueStats || !dueStats.labels || !dueStats.counts) {
        logFn("Chart creation aborted: dueStats data is missing", dueStats);
        return null;
      }
      
      const themeColors = getThemeColors();
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        logFn("Failed to get canvas context");
        return null;
      }
      
      const cumulativeCounts = [];
      let runningSum = 0;
      for (let i = 0; i < dueStats.counts.length; i++) {
        runningSum += dueStats.counts[i];
        cumulativeCounts.push(runningSum);
      }
      
      const chartConfig = {
        type: 'bar',
        data: {
          labels: dueStats.labels,
          datasets: [
            {
              label: 'Cards Due',
              data: dueStats.counts,
              backgroundColor: themeColors.barColor,
              borderWidth: 0,
              borderRadius: 4,
              order: 2
            },
            {
              label: 'Cumulative Cards',
              data: cumulativeCounts,
              type: 'line',
              borderColor: themeColors.unknownColor,
              backgroundColor: themeColors.unknownColor,
              borderWidth: 2,
              pointStyle: false,
              tension: 0.4,
              fill: 'origin',
              yAxisID: 'y1',
              order: 1
            }
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 800,
            easing: 'easeOutQuart'
          },
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Cards Due',
                color: themeColors.textColor
              },
              ticks: {
                color: themeColors.textColor,
                precision: 0,
              },
              grid: {
                color: themeColors.gridColor,
              },
            },
            y1: {
              position: 'right',
              beginAtZero: true,
              title: {
                display: true,
                text: 'Cumulative Cards',
                color: themeColors.textColor
              },
              ticks: {
                color: themeColors.textColor,
                precision: 0,
              },
              grid: {
                drawOnChartArea: false,
              },
            },
            x: {
              title: {
                display: true,
                text: 'Date',
                color: themeColors.textColor
              },
              ticks: {
                color: themeColors.textColor,
                maxRotation: 45,
                minRotation: 45,
              },
              grid: {
                color: themeColors.gridColor,
              },
            },
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: themeColors.textColor,
              }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                title: function(tooltipItems) {
                  return tooltipItems[0].label;
                },
                label: function(context) {
                  const datasetLabel = context.dataset.label || '';
                  const value = context.parsed.y;
                  const total = cumulativeCounts[cumulativeCounts.length - 1];
                  
                  if (datasetLabel === 'Cards Due' && value > 0) {
                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                    return `${datasetLabel}: ${value} (${percentage}%)`;
                  }
                  
                  if (datasetLabel === 'Cumulative Cards') {
                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0.0';
                    return `${datasetLabel}: ${value} (${percentage}%)`;
                  }
                  
                  return `${datasetLabel}: ${value}`;
                }
              },
              backgroundColor: themeColors.backgroundElevation2,
              titleFontColor: themeColors.textColor,
              caretSize: CHART_CONFIG.TOOLTIP_CONFIG.CARET_SIZE,
              padding: CHART_CONFIG.TOOLTIP_CONFIG.PADDING,
              cornerRadius: CHART_CONFIG.TOOLTIP_CONFIG.CORNER_RADIUS,
              boxPadding: CHART_CONFIG.TOOLTIP_CONFIG.BOX_PADDING,
              multiKeyBackground: themeColors.backgroundElevation1,
              bodyColor: themeColors.textColor,
              titleColor: themeColors.textColor,
            }
          },
        }
      };
      
      try {
        if (this.dueChartInstance) {
          logFn("Updating existing due chart with new data");
          
          this.dueChartInstance.data.labels = dueStats.labels;
          this.dueChartInstance.data.datasets[0].data = dueStats.counts;
          
          if (this.dueChartInstance.data.datasets.length > 1) {
            this.dueChartInstance.data.datasets[1].data = cumulativeCounts;
            this.dueChartInstance.data.datasets[1].borderColor = themeColors.unknownColor;
            this.dueChartInstance.data.datasets[1].backgroundColor = themeColors.unknownColor;
          } else {
            this.dueChartInstance.data.datasets.push({
              label: 'Cumulative Cards',
              data: cumulativeCounts,
              type: 'line',
              borderColor: themeColors.unknownColor,
              backgroundColor: themeColors.unknownColor,
              borderWidth: 2,
              pointStyle: false,
              tension: 0.4,
              yAxisID: 'y1',
              order: 1
            });
            
            if (!this.dueChartInstance.options.scales.y1) {
              this.dueChartInstance.options.scales.y1 = {
                position: 'right',
                beginAtZero: true,
                title: {
                  display: true,
                  text: 'Cumulative Cards',
                  color: themeColors.textColor
                },
                ticks: {
                  color: themeColors.textColor,
                  precision: 0,
                },
                grid: {
                  drawOnChartArea: false,
                },
              };
            }
          }
          
          this.dueChartInstance.data.datasets[0].backgroundColor = themeColors.barColor;
          
          this.dueChartInstance.options.scales.y.ticks.color = themeColors.textColor;
          this.dueChartInstance.options.scales.y.title.color = themeColors.textColor;
          this.dueChartInstance.options.scales.y.grid.color = themeColors.gridColor;
          this.dueChartInstance.options.scales.y1.ticks.color = themeColors.textColor;
          this.dueChartInstance.options.scales.y1.title.color = themeColors.textColor;
          this.dueChartInstance.options.scales.x.ticks.color = themeColors.textColor;
          this.dueChartInstance.options.scales.x.title.color = themeColors.textColor;
          this.dueChartInstance.options.scales.x.grid.color = themeColors.gridColor;
          this.dueChartInstance.options.plugins.legend.labels.color = themeColors.textColor;
          this.dueChartInstance.options.plugins.tooltip.backgroundColor = themeColors.backgroundElevation2;
          this.dueChartInstance.options.plugins.tooltip.bodyColor = themeColors.textColor;
          this.dueChartInstance.options.plugins.tooltip.titleColor = themeColors.textColor;
          
          this.dueChartInstance.options.plugins.legend.display = true;
          
          this.dueChartInstance.update();
          return this.dueChartInstance;
        }
        
        this.dueChartInstance = new Chart(ctx, chartConfig);
        logFn("Due chart created successfully");
        return this.dueChartInstance;
      } catch (error) {
        logFn("Error in due chart creation/update:", error);
        
        try {
          if (this.dueChartInstance) {
            this.dueChartInstance.destroy();
          }
          this.dueChartInstance = new Chart(ctx, chartConfig);
          logFn("Due chart recreated after error");
          return this.dueChartInstance;
        } catch (recreateError) {
          logFn("Failed to recreate due chart:", recreateError);
          return null;
        }
      }
    },
    
    /**
     * Updates or creates a review intervals bar chart
     * @param {HTMLCanvasElement} canvas - The canvas element to render on
     * @param {Object} intervalStats - The interval statistics data
     * @param {Function} logFn - Logging function
     * @returns {Object|null} - Chart instance or null if failed
     */
    createIntervalChart(canvas, intervalStats, logFn) {
      if (!canvas) {
        logFn("Interval chart creation aborted: canvas is undefined");
        return null;
      }
      
      if (!intervalStats || !intervalStats.labels || !intervalStats.counts) {
        logFn("Interval chart creation aborted: intervalStats data is missing", intervalStats);
        return null;
      }
      
      const themeColors = getThemeColors();
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        logFn("Failed to get interval chart canvas context");
        return null;
      }
      
      const cumulativeCounts = [];
      let runningSum = 0;
      for (let i = 0; i < intervalStats.counts.length; i++) {
        runningSum += intervalStats.counts[i];
        cumulativeCounts.push(runningSum);
      }
      
      const maxCount = Math.max(...intervalStats.counts);
      const maxCumulative = cumulativeCounts[cumulativeCounts.length - 1];
      
      const chartConfig = {
        type: 'bar',
        data: {
          labels: intervalStats.labels,
          datasets: [
            {
              label: 'Cards per Interval',
              data: intervalStats.counts,
              backgroundColor: themeColors.accent1,
              borderWidth: 0,
              borderRadius: 4,
              order: 2
            },
            {
              label: 'Cumulative Cards',
              data: cumulativeCounts,
              type: 'line',
              borderColor: themeColors.accent1Transparent,
              backgroundColor: themeColors.accent1Transparent,
              borderWidth: 2,
              pointStyle: false,
              tension: 0.4,
              fill: 'origin',
              yAxisID: 'y1',
              order: 1
            }
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
            y: {
              beginAtZero: true,
              title: {
                display: true,
                text: 'Number of Cards',
                color: themeColors.textColor
              },
              ticks: {
                color: themeColors.textColor,
                precision: 0,
              },
              grid: {
                color: themeColors.gridColor,
              },
            },
            y1: {
              position: 'right',
              beginAtZero: true,
              title: {
                display: true,
                text: 'Cumulative Cards',
                color: themeColors.textColor
              },
              ticks: {
                color: themeColors.textColor,
                precision: 0,
              },
              grid: {
                drawOnChartArea: false,
              },
            },
            x: {
              title: {
                display: true,
                text: 'Review Interval (Days)',
                color: themeColors.textColor
              },
              ticks: {
                color: themeColors.textColor,
                maxRotation: 45,
                minRotation: 45,
              },
              grid: {
                color: themeColors.gridColor,
              },
            },
          },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: themeColors.textColor,
              }
            },
            tooltip: {
              mode: 'index',
              intersect: false,
              callbacks: {
                title: function(tooltipItems) {
                  return tooltipItems[0].label;
                },
                label: function(context) {
                  const datasetLabel = context.dataset.label || '';
                  const value = context.parsed.y;
                  const total = cumulativeCounts[cumulativeCounts.length - 1];
                  
                  if (datasetLabel === 'Cards per Interval' && value > 0) {
                    const percentage = ((value / total) * 100).toFixed(1);
                    return `${datasetLabel}: ${value} (${percentage}%)`;
                  }
                  
                  if (datasetLabel === 'Cumulative Cards') {
                    const percentage = ((value / total) * 100).toFixed(1);
                    return `${datasetLabel}: ${value} (${percentage}%)`;
                  }
                  
                  return `${datasetLabel}: ${value}`;
                }
              },
              backgroundColor: themeColors.backgroundElevation2,
              titleFontColor: themeColors.textColor,
              caretSize: CHART_CONFIG.TOOLTIP_CONFIG.CARET_SIZE,
              padding: CHART_CONFIG.TOOLTIP_CONFIG.PADDING,
              cornerRadius: CHART_CONFIG.TOOLTIP_CONFIG.CORNER_RADIUS,
              boxPadding: CHART_CONFIG.TOOLTIP_CONFIG.BOX_PADDING,
              multiKeyBackground: themeColors.backgroundElevation1,
              bodyColor: themeColors.textColor,
              titleColor: themeColors.textColor,
            }
          },
        }
      };
      
      try {
        if (this.intervalChartInstance) {
          logFn("Updating existing interval chart with new data");
          
          this.intervalChartInstance.data.labels = intervalStats.labels;
          this.intervalChartInstance.data.datasets[0].data = intervalStats.counts;
          this.intervalChartInstance.data.datasets[1].data = cumulativeCounts;
          
          this.intervalChartInstance.data.datasets[0].backgroundColor = themeColors.accent1;
          this.intervalChartInstance.data.datasets[1].borderColor = themeColors.accent1Transparent;
          this.intervalChartInstance.data.datasets[1].backgroundColor = themeColors.accent1Transparent;
          
          this.intervalChartInstance.options.scales.y.ticks.color = themeColors.textColor;
          this.intervalChartInstance.options.scales.y.title.color = themeColors.textColor;
          this.intervalChartInstance.options.scales.y.grid.color = themeColors.gridColor;
          this.intervalChartInstance.options.scales.y1.ticks.color = themeColors.textColor;
          this.intervalChartInstance.options.scales.y1.title.color = themeColors.textColor;
          this.intervalChartInstance.options.scales.x.ticks.color = themeColors.textColor;
          this.intervalChartInstance.options.scales.x.title.color = themeColors.textColor;
          this.intervalChartInstance.options.scales.x.grid.color = themeColors.gridColor;
          this.intervalChartInstance.options.plugins.legend.labels.color = themeColors.textColor;
          this.intervalChartInstance.options.plugins.tooltip.backgroundColor = themeColors.backgroundElevation2;
          this.intervalChartInstance.options.plugins.tooltip.bodyColor = themeColors.textColor;
          this.intervalChartInstance.options.plugins.tooltip.titleColor = themeColors.textColor;
          
          this.intervalChartInstance.update();
          return this.intervalChartInstance;
        }
        
        this.intervalChartInstance = new Chart(ctx, chartConfig);
        logFn("Interval chart created successfully");
        return this.intervalChartInstance;
      } catch (error) {
        logFn("Error in interval chart creation/update:", error);
        
        try {
          if (this.intervalChartInstance) {
            this.intervalChartInstance.destroy();
          }
          this.intervalChartInstance = new Chart(ctx, chartConfig);
          logFn("Interval chart recreated after error");
          return this.intervalChartInstance;
        } catch (recreateError) {
          logFn("Failed to recreate interval chart:", recreateError);
          return null;
        }
      }
    },
    
    /**
     * Updates charts with new data and theme
     * @param {Object} options - Configuration options
     * @param {HTMLCanvasElement} options.wordCanvas - Word chart canvas
     * @param {HTMLCanvasElement} options.dueCanvas - Due chart canvas
     * @param {HTMLCanvasElement} options.intervalCanvas - Interval chart canvas
     * @param {Object} options.wordStats - Word statistics data
     * @param {Object} options.dueStats - Due statistics data
     * @param {Object} options.intervalStats - Interval statistics data
     * @param {Function} options.onComplete - Callback after charts are rendered
     * @param {Function} options.logFn - Logging function
     */
    updateCharts(options) {
      const { wordCanvas, dueCanvas, intervalCanvas, wordStats, dueStats, intervalStats, onComplete, logFn } = options;
      
      logFn("Chart update triggered");
      
      let wordChartSuccess = false;
      let dueChartSuccess = false;
      let intervalChartSuccess = false;
      
      if (wordCanvas && wordStats) {
        wordChartSuccess = !!this.createWordChart(wordCanvas, wordStats, logFn);
      }
      
      if (dueCanvas && dueStats && dueStats.labels && dueStats.counts) {
        dueChartSuccess = !!this.createDueChart(dueCanvas, dueStats, logFn);
      }
      
      if (intervalCanvas && intervalStats && intervalStats.labels && intervalStats.counts) {
        intervalChartSuccess = !!this.createIntervalChart(intervalCanvas, intervalStats, logFn);
      }
      
      if (onComplete) {
        onComplete({
          wordChartSuccess,
          dueChartSuccess,
          intervalChartSuccess
        });
      }
    },
    
    destroyCharts() {
      if (this.wordChartInstance) {
        try {
          this.wordChartInstance.destroy();
          this.wordChartInstance = null;
        } catch (e) {
          console.error("Error destroying word chart instance:", e);
        }
      }
      
      if (this.dueChartInstance) {
        try {
          this.dueChartInstance.destroy();
          this.dueChartInstance = null;
        } catch (e) {
          console.error("Error destroying due chart instance:", e);
        }
      }
      
      if (this.intervalChartInstance) {
        try {
          this.intervalChartInstance.destroy();
          this.intervalChartInstance = null;
        } catch (e) {
          console.error("Error destroying interval chart instance:", e);
        }
      }
    }
  };

  GM_addStyle(css);

  function createExtensionLogger() {
    return function () {
      const args = Array.from(arguments);
      if (SETTINGS.ENVIRONMENT === "dev") {
        console.log("Migaku Custom Stats:", ...args);
      }
    };
  }
  const extensionLog = createExtensionLogger();

  const dbName = DB_CONFIG.DB_NAME;
  const objectStoreName = DB_CONFIG.OBJECT_STORE;
  const statisticsElementSelector = SELECTORS.STATISTICS_ELEMENT;
  const targetElementSelector = SELECTORS.TARGET_ELEMENT;
  const statsRoute = ROUTES.STATS_ROUTE;

  function waitForElement(selector, timeout = SETTINGS.DEFAULT_TIMEOUT) {
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
      if (dbState.migakuDB) {
        extensionLog("Using existing DB connection.");
        resolve(dbState.migakuDB);
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
        dbState.migakuDB = event.target.result;
        resolve(dbState.migakuDB);
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
      if (appState.languageChangeObserver) {
        extensionLog("Disconnecting language change observer.");
        appState.languageChangeObserver.disconnect();
        appState.languageChangeObserver = null;
      }
      return;
    }

    const mainElement = await waitForElement(SELECTORS.MIGAKU_MAIN);
    if (!mainElement) {
      extensionLog("Migaku main element not found, skipping logic.");
      if (appState.languageChangeObserver) {
        extensionLog("Migaku element lost, disconnecting language change observer.");
        appState.languageChangeObserver.disconnect();
        appState.languageChangeObserver = null;
      }
      return;
    }

    if (!appState.languageChangeObserver) {
      extensionLog("Setting up language change observer.");
      appState.languageChangeObserver = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === ATTRIBUTES.LANG_SELECTED
          ) {
            const newLanguage = mainElement.getAttribute(ATTRIBUTES.LANG_SELECTED);
            extensionLog(`Language attribute changed to: ${newLanguage}`);
            
            appState.selectedDeckId = SETTINGS.DEFAULT_DECK_ID;
            extensionLog(`Reset deck selection to '${UI_TEXTS.ALL_DECKS}' due to language change`);
            
            runStatsLogic();
            break;
          }
        }
      });
      appState.languageChangeObserver.observe(mainElement, {
        attributes: true,
        attributeFilter: [ATTRIBUTES.LANG_SELECTED],
      });
      extensionLog("Language change observer attached.");
    }

    let currentLanguage;
    try {
      currentLanguage = mainElement.attributes.getNamedItem(ATTRIBUTES.LANG_SELECTED).value;
      if (currentLanguage !== appState.selectedLanguage) {
        extensionLog("Processing for language:", currentLanguage);
      } else {
        extensionLog("Language unchanged, re-validating stats...");
      }
    } catch (error) {
      extensionLog("Could not read selected language attribute.", error);
      dbState.lastWordStats = null;
      dbState.lastDueStats = null;
      dbState.lastIntervalStats = null;
      await displayCustomStats("Error: Could not determine selected language. Please reload the page.")
        .catch((e) => extensionLog("Failed to display language error", e));
      appState.isProcessing = false;
      return;
    }

    if (appState.isProcessing && appState.selectedLanguage === currentLanguage) {
      extensionLog("Stats logic already running for the current language, skipping.");
      return;
    }

    if (currentLanguage === appState.selectedLanguage && appState.isProcessing) {
      extensionLog(`Skipping run: Language (${currentLanguage}) hasn't changed and processing is ongoing.`);
      return;
    }
    
    if (currentLanguage === appState.selectedLanguage && !appState.isProcessing) {
      extensionLog(`Language (${currentLanguage}) hasn't changed since last successful run. Checking if stats need refresh.`);
    }

    if (currentLanguage !== appState.selectedLanguage) {
      appState.selectedDeckId = SETTINGS.DEFAULT_DECK_ID;
      extensionLog(`Language changed from "${appState.selectedLanguage}" to "${currentLanguage}". Reset deck to "${UI_TEXTS.ALL_DECKS}".`);
      ChartManager.resetCharts();
    }

    appState.selectedLanguage = currentLanguage;
    appState.isProcessing = true;
    extensionLog("Running stats logic for language:", appState.selectedLanguage);

    try {
      const db = await initDB();
      if (!db) {
        throw new Error("Failed to initialize database connection.");
      }
      await accessMigakuData(db);
    } catch (error) {
      extensionLog("Error in runStatsLogic:", error);
      dbState.lastWordStats = null;
      dbState.lastDueStats = null;
      dbState.lastIntervalStats = null;
      await displayCustomStats(`Error loading statistics: ${error.message}. Please try again later.`)
        .catch((e) => extensionLog("Failed to display run error", e));
    } finally {
      appState.isProcessing = false;
      extensionLog("Stats logic processing finished for language:", appState.selectedLanguage);
    }
  }

  // =========================================================================
  // Database Helpers
  // =========================================================================
  
  /**
   * Decompresses a gzipped Uint8Array
   * @param {Uint8Array} compressedData - The compressed data blob
   * @param {Function} logFn - Logging function
   * @returns {Uint8Array|null} - Decompressed data or null if failed
   */
  function decompressData(compressedData, logFn) {
    try {
      logFn("Attempting Gzip decompression...");
      const decompressedData = pako.inflate(compressedData);
      logFn("Decompression successful.");
      return decompressedData;
    } catch (err) {
      logFn("Gzip Decompression failed:", err);
      return null;
    }
  }
  
  /**
   * Initializes the SQL.js engine
   * @param {Function} logFn - Logging function
   * @returns {Object|null} - SQL.js instance or null if failed
   */
  async function initializeSqlEngine(logFn) {
    try {
      logFn("Initializing sql.js...");
      const SQL = await initSqlJs({
        locateFile: (file) => `${DB_CONFIG.SQL_CDN_PATH}${file}`,
      });
      logFn("sql.js initialized successfully.");
      return SQL;
    } catch (err) {
      logFn("Failed to initialize sql.js:", err);
      return null;
    }
  }
  
  /**
   * Fetches available decks for the selected language
   * @param {Object} dbInstance - SQL.js database instance
   * @param {string} language - Selected language
   * @param {Function} logFn - Logging function
   * @returns {Array} - Array of deck objects with id and name
   */
  function fetchDecks(dbInstance, language, logFn) {
    const decks = [{ id: SETTINGS.DEFAULT_DECK_ID, name: UI_TEXTS.ALL_DECKS }];
    
    try {
      const decksResults = dbInstance.exec(SQL_QUERIES.DECKS_QUERY, [language]);
      
      if (decksResults.length > 0 && decksResults[0].values.length > 0) {
        logFn("Decks query results:", decksResults[0]);
        
        decksResults[0].values.forEach((row) => {
          const id = String(row[0]);
          const name = row[1];
          decks.push({ id, name });
        });
        
        logFn("Available decks:", decks);
      } else {
        logFn("No decks found for language:", language);
      }
    } catch (decksError) {
      logFn("Error fetching decks:", decksError);
    }
    
    return decks;
  }
  
  /**
   * Fetches word statistics for the selected language and deck
   * @param {Object} dbInstance - SQL.js database instance
   * @param {string} language - Selected language
   * @param {string} deckId - Selected deck ID
   * @param {Function} logFn - Logging function
   * @returns {Object|null} - Word statistics or null if failed
   */
  function fetchWordStats(dbInstance, language, deckId, logFn) {
    try {
      let wordQuery = SQL_QUERIES.WORD_QUERY;
      let wordQueryParams = [language];
      
      if (deckId !== SETTINGS.DEFAULT_DECK_ID) {
        wordQuery = SQL_QUERIES.WORD_QUERY_WITH_DECK;
        wordQueryParams = [language, deckId];
      }
      
      const wordResults = dbInstance.exec(wordQuery, wordQueryParams);
      
      if (wordResults.length > 0 && wordResults[0].values.length > 0) {
        logFn("Word query results:", wordResults);
        const numberOfResults = wordResults[0].values[0].length;
        const wordValues = {};
        
        for (let i = 0; i < numberOfResults; i++) {
          wordValues[wordResults[0].columns[i]] = wordResults[0].values[0][i];
        }
        
        return wordValues;
      } else {
        logFn("Word query returned no results.");
        return null;
      }
    } catch (error) {
      logFn("Error fetching word stats:", error);
      return null;
    }
  }
  
  /**
   * Fetches due cards statistics for the selected language and deck
   * @param {Object} dbInstance - SQL.js database instance
   * @param {string} language - Selected language
   * @param {string} deckId - Selected deck ID
   * @param {Function} logFn - Logging function
   * @returns {Object|null} - Due cards statistics or null if failed
   */
  function fetchDueStats(dbInstance, language, deckId, logFn) {
    try {
      const startDate = new Date(CHART_CONFIG.START_YEAR, CHART_CONFIG.START_MONTH, CHART_CONFIG.START_DAY);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const todayDayNumber = Math.floor((today - startDate) / (1000 * 60 * 60 * 24)) + 1;
      const endDayNumber = todayDayNumber + (CHART_CONFIG.FORECAST_DAYS - 1);
      
      logFn(`Calculating due cards between day ${todayDayNumber} and ${endDayNumber}`);
      
      let dueQuery = SQL_QUERIES.DUE_QUERY;
      let dueQueryParams = [language, todayDayNumber, endDayNumber];
      
      if (deckId !== SETTINGS.DEFAULT_DECK_ID) {
        dueQuery += " AND c.deckId = ?";
        dueQueryParams.push(deckId);
      }
      
      dueQuery += " GROUP BY due ORDER BY due";
      
      const dueResults = dbInstance.exec(dueQuery, dueQueryParams);
      
      const dateLabels = [];
      const dateCounts = [];
      const tempDate = new Date(today);
      
      for (let i = 0; i < CHART_CONFIG.FORECAST_DAYS; i++) {
        const label = tempDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        });
        dateLabels.push(label);
        dateCounts.push(0);
        tempDate.setDate(tempDate.getDate() + 1);
      }
      
      if (dueResults.length > 0 && dueResults[0].values.length > 0) {
        logFn("Due cards query results:", dueResults[0]);
        const dueCountsByDay = {};
        
        dueResults[0].values.forEach((row) => {
          const resultRow = {};
          dueResults[0].columns.forEach((col, index) => {
            resultRow[col] = row[index];
          });
          dueCountsByDay[resultRow.due] = resultRow.count;
        });
        
        for (let i = 0; i < CHART_CONFIG.FORECAST_DAYS; i++) {
          const dayNum = todayDayNumber + i;
          if (dueCountsByDay[dayNum]) {
            dateCounts[i] = dueCountsByDay[dayNum];
          }
        }
      } else {
        logFn("Due cards query returned no results.");
      }
      
      return { labels: dateLabels, counts: dateCounts };
    } catch (error) {
      logFn("Error fetching due stats:", error);
      return null;
    }
  }

  /**
   * Fetches review interval statistics for the selected language and deck
   * @param {Object} dbInstance - SQL.js database instance
   * @param {string} language - Selected language
   * @param {string} deckId - Selected deck ID
   * @param {Function} logFn - Logging function
   * @returns {Object|null} - Interval statistics or null if failed
   */
  function fetchIntervalStats(dbInstance, language, deckId, logFn) {
    try {
      let intervalQuery = SQL_QUERIES.INTERVAL_QUERY;
      let intervalQueryParams = [language];
      
      if (deckId !== SETTINGS.DEFAULT_DECK_ID) {
        intervalQuery = intervalQuery.replace("WHERE ct.lang = ? AND c.del = 0 AND c.interval > 0", 
                                             "WHERE ct.lang = ? AND c.del = 0 AND c.interval > 0 AND c.deckId = ?");
        intervalQueryParams.push(deckId);
      }
      
      const intervalResults = dbInstance.exec(intervalQuery, intervalQueryParams);
      
      if (intervalResults.length > 0 && intervalResults[0].values.length > 0) {
        logFn("Interval query results:", intervalResults[0]);
        
        const intervalMap = new Map();
        let maxInterval = 0;
        let totalCards = 0;
        
        intervalResults[0].values.forEach((row) => {
          const interval = Math.round(row[0]);
          const count = row[1];
          intervalMap.set(interval, count);
          maxInterval = Math.max(maxInterval, interval);
          totalCards += count;
        });
        
        const cutoffPercentile = 0.95; // 95th percentile (exclude top 5%)
        let cumulativeCount = 0;
        let cutoffInterval = maxInterval;
        
        const sortedIntervals = Array.from(intervalMap.keys()).sort((a, b) => a - b);
        
        for (const interval of sortedIntervals) {
          cumulativeCount += intervalMap.get(interval);
          const percentile = cumulativeCount / totalCards;
          
          if (percentile >= cutoffPercentile) {
            cutoffInterval = interval;
            break;
          }
        }
        
        logFn(`Excluding intervals beyond ${cutoffInterval} days (top 5% outliers)`);
        
        const intervalLabels = [];
        const intervalCounts = [];
        
        for (let i = 1; i <= cutoffInterval; i++) {
          let label = i === 1 ? "1 day" : `${i} days`;
          
          intervalLabels.push(label);
          intervalCounts.push(intervalMap.has(i) ? intervalMap.get(i) : 0);
        }
        
        return { labels: intervalLabels, counts: intervalCounts };
      } else {
        logFn("Interval query returned no results.");
        return null;
      }
    } catch (error) {
      logFn("Error fetching interval stats:", error);
      return null;
    }
  }

  async function accessMigakuData(db, vueInstance = null) {
    if (!db.objectStoreNames.contains(objectStoreName)) {
      extensionLog(
        `Object store "${objectStoreName}" not found in database "${dbName}".`
      );
      extensionLog(
        `Available stores: ${Array.from(db.objectStoreNames).join(", ")}`
      );
      
      const errorMessage = `Object store '${objectStoreName}' not found.`;
      
      if (vueInstance) {
        vueInstance.updateData({
          wordStats: null,
          dueStats: null,
          intervalStats: null,
          message: errorMessage,
          isError: true
        });
        return;
      }
      
      await displayCustomStats(
        "Error",
        errorMessage
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
        
        const errorMessage = `Error reading DB: ${event.target.error}`;
        
        if (vueInstance) {
          vueInstance.updateData({
            wordStats: null,
            dueStats: null,
            intervalStats: null,
            message: errorMessage,
            isError: true
          });
          reject(event.target.error);
          return;
        }
        
        displayCustomStats(errorMessage).catch(
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
            
            const errorMessage = "Could not find SQLite data blob.";
            
            if (vueInstance) {
              vueInstance.updateData({
                wordStats: null,
                dueStats: null,
                intervalStats: null,
                message: errorMessage,
                isError: true
              });
              resolve();
              return;
            }
            
            await displayCustomStats(
              "Error",
              errorMessage
            ).catch((e) =>
              extensionLog("Failed to display structure error", e)
            );
            resolve();
            return;
          }

          let dbFileBlob = allRecords[0].data;
          
          dbFileBlob = decompressData(dbFileBlob, extensionLog);
          if (!dbFileBlob) {
            const errorMessage = "Gzip decompression failed.";
            
            if (vueInstance) {
              vueInstance.updateData({
                wordStats: null,
                dueStats: null,
                intervalStats: null,
                message: errorMessage,
                isError: true
              });
              resolve();
              return;
            }
            
            await displayCustomStats(
              "Error",
              errorMessage
            ).catch((e) =>
              extensionLog("Failed to display decompression error", e)
            );
            resolve();
            return;
          }
          
          const SQL = await initializeSqlEngine(extensionLog);
          if (!SQL) {
            const errorMessage = "Failed to load sql.js engine.";
            
            if (vueInstance) {
              vueInstance.updateData({
                wordStats: null,
                dueStats: null,
                intervalStats: null,
                message: errorMessage,
                isError: true
              });
              resolve();
              return;
            }
            
            await displayCustomStats(
              "Error",
              errorMessage
            ).catch((e) =>
              extensionLog("Failed to display sql.js init error", e)
            );
            resolve();
            return;
          }

          let dbInstance = null;
          
          try {
            extensionLog("Loading database into sql.js...");
            dbInstance = new SQL.Database(dbFileBlob);
            extensionLog("Database loaded successfully.");
            extensionLog("Executing SQL queries...");
            
            const decks = fetchDecks(dbInstance, appState.selectedLanguage, extensionLog);
            dbState.availableDecks = decks;
            
            const wordValues = fetchWordStats(
              dbInstance, 
              appState.selectedLanguage, 
              appState.selectedDeckId, 
              extensionLog
            );
            
            const dueData = fetchDueStats(
              dbInstance, 
              appState.selectedLanguage, 
              appState.selectedDeckId, 
              extensionLog
            );
            
            const intervalData = fetchIntervalStats(
              dbInstance, 
              appState.selectedLanguage, 
              appState.selectedDeckId, 
              extensionLog
            );

            dbState.lastWordStats = wordValues;
            dbState.lastDueStats = dueData;
            dbState.lastIntervalStats = intervalData;

            if (vueInstance) {
              vueInstance.updateData({
                wordStats: wordValues,
                dueStats: dueData,
                intervalStats: intervalData,
                availableDecks: dbState.availableDecks,
                isError: false,
                message: ""
              });
              resolve();
              return;
            }

            if (wordValues || (dueData && dueData.labels.length > 0) || (intervalData && intervalData.labels.length > 0)) {
              await displayCustomStats({
                wordStats: wordValues,
                dueStats: dueData,
                intervalStats: intervalData
              });
            } else {
              extensionLog(
                "All queries returned no usable data. Displaying message."
              );
              await displayCustomStats(
                UI_TEXTS.NO_DATA_MESSAGE
              );
            }
          } catch (error) {
            extensionLog("Error during SQL execution/processing:", error);
            dbState.lastWordStats = null;
            dbState.lastDueStats = null;
            dbState.lastIntervalStats = null;
            
            if (vueInstance) {
              vueInstance.updateData({
                wordStats: null,
                dueStats: null,
                intervalStats: null,
                message: `Processing error: ${error.message}`,
                isError: true
              });
              resolve();
              return;
            }
            
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
          dbState.lastWordStats = null;
          dbState.lastDueStats = null;
          dbState.lastIntervalStats = null;
          
          if (vueInstance) {
            vueInstance.updateData({
              wordStats: null,
              dueStats: null,
              intervalStats: null,
              message: `Internal script error: ${outerError.message}`,
              isError: true
            });
            resolve();
            return;
          }
          
          await displayCustomStats(
            `Internal script error: ${outerError.message}`
          );
          resolve();
        }
      };
    });
  }

  // =========================================================================
  // Vue Components
  // =========================================================================

  const DeckSelector = {
    props: {
      availableDecks: Array,
      selectedDeckId: String,
      componentHash: String
    },
    data() {
      return {
        isDropdownOpen: false
      };
    },
    computed: {
      selectedDeckName() {
        const deck = this.availableDecks.find(d => d.id === this.selectedDeckId);
        return deck ? deck.name : UI_TEXTS.ALL_DECKS;
      }
    },
    methods: {
      toggleDropdown(event) {
        event.stopPropagation();
        this.isDropdownOpen = !this.isDropdownOpen;
      },
      selectDeck(deckId, event) {
        event.stopPropagation();
        if (this.selectedDeckId === deckId) {
          this.isDropdownOpen = false;
          return;
        }
        
        this.$emit('deck-selected', deckId);
        this.isDropdownOpen = false;
      },
      closeDropdown() {
        this.isDropdownOpen = false;
      }
    },
    mounted() {
      document.addEventListener('click', this.closeDropdown);
    },
    beforeUnmount() {
      document.removeEventListener('click', this.closeDropdown);
    },
    template: `
      <div v-bind:[componentHash]="true" class="MCS__deck-selector UiFormField SettingsGeneral__optionLeft">
        <div class="UiFormField__labelContainer">
          <label v-bind:[componentHash]="true" class="UiTypo UiTypo__body UiFormField__labelContainer__typo">Deck</label>
        </div>
        <div class="UiFormField__controlContainer">
          <div
            tabindex="0"
            class="multiselect multiselect--right -has-value"
            role="combobox"
            style="width: 250px;"
            :class="{'multiselect--active': isDropdownOpen}"
            @click="toggleDropdown"
          >
            <div class="UiIcon multiselect__caret" style="width: 24px;">
              <div class="UiIcon__inner">
                <div class="UiSvg UiIcon__svg" name="ChevronDownSmall" gradient="false" spin="false">
                  <div class="UiSvg__inner">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" role="img">
                      <path fill="currentColor" fill-rule="evenodd" d="M7.116 10.116a1.25 1.25 0 0 1 1.768 0L12 13.232l3.116-3.116a1.25 1.25 0 0 1 1.768 1.768l-4 4a1.25 1.25 0 0 1-1.768 0l-4-4a1.25 1.25 0 0 1 0-1.768" clip-rule="evenodd"></path>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
            <div class="multiselect__tags">
              <span class="multiselect__single">
                <span class="UiTypo UiTypo__caption -no-wrap multiselect__single__text">{{ selectedDeckName }}</span>
              </span>
            </div>
            <div 
              class="multiselect__content-wrapper"
              tabindex="-1"
              style="max-height: 300px;" 
              :style="{display: isDropdownOpen ? 'block' : 'none'}"
            >
              <ul class="multiselect__content" role="listbox" style="display: inline-block;">
                <li class="multiselect__element" role="option" v-for="deck in availableDecks" :key="deck.id">
                  <span
                    class="multiselect__option" 
                    :class="{'multiselect__option--highlight multiselect__option--selected': deck.id === selectedDeckId}"
                    @click="selectDeck(deck.id, $event)"
                  >
                    <div class="multiselect__optionWrapper" style="width: 180px;">
                      <span
                        class="UiTypo UiTypo__caption"
                        :class="{'-emphasis': deck.id === selectedDeckId}"
                        style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                      >
                        {{ deck.name }}
                      </span>
                      <div class="UiIcon multiselect__checkIcon" style="width: 24px;">
                        <div v-if="deck.id === selectedDeckId" class="UiIcon__inner">
                          <div class="UiSvg UiIcon__svg" name="Check" gradient="true" spin="false">
                            <div class="UiSvg__inner UiIcon__gradient" :style="'clip-path: url(#checkmark-' + deck.id + ');'">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" role="img">
                                <defs>
                                  <clipPath :id="'checkmark-' + deck.id" data-dont-prefix-id="" transform="scale(1)">
                                    <path fill="currentColor" fill-rule="evenodd" d="M19.83 7.066a1.25 1.25 0 0 1 .104 1.764l-8 9a1.25 1.25 0 0 1-1.818.054l-5-5a1.25 1.25 0 0 1 1.768-1.768l4.063 4.063 7.119-8.01a1.25 1.25 0 0 1 1.765-.103" clip-rule="evenodd">
                                    </path>
                                  </clipPath>
                                </defs>
                              </svg>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    `
  };

  const WordStatsCard = {
    props: {
      wordStats: Object,
      componentHash: String,
      chartRef: String
    },
    mounted() {
      this.$nextTick(() => {
        if (this.$refs.canvas) {
          this.$emit('canvas-mounted', this.$refs.canvas);
        }
      });
    },
    updated() {
      this.$nextTick(() => {
        if (this.$refs.canvas) {
          this.$emit('canvas-mounted', this.$refs.canvas);
        }
      });
    },
    beforeUnmount() {
      this.$emit('canvas-unmounted');
    },
    template: `
      <div v-if="wordStats" v-bind:[componentHash]="true" class="MCS__word-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Word Status</h3>
        </div>
        <div v-bind:[componentHash]="true" class="MCS__wordcount">
          <div v-bind:[componentHash]="true" class="MCS__wordcount__details">
            <div v-bind:[componentHash]="true" class="MCS__wordcount__details__column">
              <div v-bind:[componentHash]="true">
                <span class="UiTypo UiTypo__caption">Known:</span> 
                <span class="UiTypo UiTypo__heading4 -heading -inline">{{ wordStats.known_count ?? 'N/A' }}</span>
              </div>
              <div v-bind:[componentHash]="true">
                <span class="UiTypo UiTypo__caption">Learning:</span> 
                <span class="UiTypo UiTypo__heading4 -heading -inline">{{ wordStats.learning_count ?? 'N/A' }}</span>
              </div>
              <div v-bind:[componentHash]="true">
                <span class="UiTypo UiTypo__caption">Unknown:</span> 
                <span class="UiTypo UiTypo__heading4 -heading -inline">{{ wordStats.unknown_count ?? 'N/A' }}</span>
              </div>
              <div v-bind:[componentHash]="true">
                <span class="UiTypo UiTypo__caption">Ignored:</span> 
                <span class="UiTypo UiTypo__heading4 -heading -inline">{{ wordStats.ignored_count ?? 'N/A' }}</span>
              </div>
            </div>
          </div>
          <div v-bind:[componentHash]="true" class="MCS__wordcount__piechart">
            <canvas ref="canvas"></canvas>
          </div>
        </div>
      </div>
      <div v-else v-bind:[componentHash]="true" class="MCS__word-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Word Status</h3>
        </div>
        <p v-bind:[componentHash]="true" class="UiTypo UiTypo__body2">Could not load word status data.</p>
      </div>
    `
  };

  const DueStatsCard = {
    props: {
      dueStats: Object,
      componentHash: String,
      chartRef: String
    },
    mounted() {
      this.$nextTick(() => {
        if (this.$refs.canvas) {
          this.$emit('canvas-mounted', this.$refs.canvas);
        }
      });
    },
    updated() {
      this.$nextTick(() => {
        if (this.$refs.canvas) {
          this.$emit('canvas-mounted', this.$refs.canvas);
        }
      });
    },
    beforeUnmount() {
      this.$emit('canvas-unmounted');
    },
    template: `
      <div v-if="dueStats && dueStats.labels && dueStats.counts" v-bind:[componentHash]="true" class="MCS__due-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Cards Due (Next ${CHART_CONFIG.FORECAST_DAYS} Days)</h3>
        </div>
        <div v-bind:[componentHash]="true" class="MCS__duechart">
          <canvas ref="canvas"></canvas>
        </div>
      </div>
      <div v-else v-bind:[componentHash]="true" class="MCS__due-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Cards Due (Next ${CHART_CONFIG.FORECAST_DAYS} Days)</h3>
        </div>
        <p v-bind:[componentHash]="true" class="UiTypo UiTypo__body2">Could not load due card data.</p>
      </div>
    `
  };

  const MessageCard = {
    props: {
      isError: Boolean,
      message: String,
      componentHash: String
    },
    template: `
      <div v-bind:[componentHash]="true" class="Statistic__card__header">
        <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">
          {{ isError ? '${UI_TEXTS.ERROR_TITLE}' : '${UI_TEXTS.INFO_TITLE}' }}
        </h3>
      </div>
      <div v-bind:[componentHash]="true" class="MCS__message">
        <span v-bind:[componentHash]="true" class="UiTypo UiTypo__body1">{{ message }}</span>
      </div>
    `
  };

  const IntervalStatsCard = {
    props: {
      intervalStats: Object,
      componentHash: String,
      chartRef: String
    },
    mounted() {
      this.$nextTick(() => {
        if (this.$refs.canvas) {
          this.$emit('canvas-mounted', this.$refs.canvas);
        }
      });
    },
    updated() {
      this.$nextTick(() => {
        if (this.$refs.canvas) {
          this.$emit('canvas-mounted', this.$refs.canvas);
        }
      });
    },
    beforeUnmount() {
      this.$emit('canvas-unmounted');
    },
    template: `
      <div v-if="intervalStats && intervalStats.labels && intervalStats.counts" v-bind:[componentHash]="true" class="MCS__interval-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Review Intervals (95th Percentile)</h3>
        </div>
        <div v-bind:[componentHash]="true" class="MCS__intervalchart">
          <canvas ref="canvas"></canvas>
        </div>
      </div>
      <div v-else v-bind:[componentHash]="true" class="MCS__interval-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Review Intervals (95th Percentile)</h3>
        </div>
        <p v-bind:[componentHash]="true" class="UiTypo UiTypo__body2">Could not load review interval data.</p>
      </div>
    `
  };

  /**
   * Prepares and displays the Vue component with stats data
   * 
   * @param {Object|string} data - Stats data or error message
   * @returns {Object|null} - Vue app instance or null
   */
  async function displayCustomStats(data) {
    extensionLog("Preparing to display Vue application...");
    
    const statisticsDiv = await waitForElement(statisticsElementSelector);
    if (!statisticsDiv) {
      extensionLog("Statistics element not found, cannot display stats.");
      return null;
    }

    const componentHash = statisticsDiv.attributes[0].nodeName;

    const statsContainer = await waitForElement(targetElementSelector);
    if (!statsContainer) {
      extensionLog("Target container not found, cannot display stats.");
      return null;
    }
    extensionLog("Target element confirmed for display:", targetElementSelector);

    const oldVueContainer = statsContainer.querySelector(`#${SELECTORS.VUE_CONTAINER_ID}`);
    if (oldVueContainer) oldVueContainer.remove();

    const isError = typeof data === "string" || data instanceof Error;
    let wordStats = null;
    let dueStats = null;
    let intervalStats = null;
    let message = "";

    if (isError) {
      message = data instanceof Error ? `Error: ${data.message}` : data;
      extensionLog(`Displaying message: ${message}`);
      if (!(data && data.hasOwnProperty("wordStats"))) {
        dbState.lastWordStats = null;
        dbState.lastDueStats = null;
        dbState.lastIntervalStats = null;
      }
    } else if (data && (data.wordStats || data.dueStats || data.intervalStats)) {
      wordStats = data.wordStats;
      dueStats = data.dueStats;
      intervalStats = data.intervalStats;
      if (data !== dbState.lastWordStats) {
        dbState.lastWordStats = wordStats;
        dbState.lastDueStats = dueStats;
        dbState.lastIntervalStats = intervalStats;
      }
      extensionLog("Displaying data:", { wordStats, dueStats, intervalStats });
    } else {
      message = UI_TEXTS.LOADING_MESSAGE;
      extensionLog(message);
      dbState.lastWordStats = null;
      dbState.lastDueStats = null;
      dbState.lastIntervalStats = null;
    }

    const vueContainer = document.createElement('div');
    vueContainer.id = SELECTORS.VUE_CONTAINER_ID;
    statsContainer.appendChild(vueContainer);

    const app = Vue.createApp({
      components: {
        DeckSelector,
        WordStatsCard,
        DueStatsCard,
        MessageCard,
        IntervalStatsCard
      },
      data() {
        return {
          wordStats,
          dueStats,
          intervalStats,
          isError,
          message,
          availableDecks: dbState.availableDecks,
          selectedDeckId: appState.selectedDeckId,
          selectedLanguage: appState.selectedLanguage,
          componentHash,
          currentTheme: getCurrentTheme(),
          wordChartRendered: false,
          dueChartRendered: false,
          intervalChartRendered: false,
          wordCanvas: null,
          dueCanvas: null,
          intervalCanvas: null
        };
      },
      methods: {
        handleDeckSelected(deckId) {
          if (this.selectedDeckId === deckId) {
            return;
          }
          
          this.selectedDeckId = deckId; 
          appState.selectedDeckId = deckId;
          
          runFilteredStatsQuery(this);
        },
        handleWordCanvasMounted(canvas) {
          this.wordCanvas = canvas;
          this.updateCharts();
        },
        handleDueCanvasMounted(canvas) {
          this.dueCanvas = canvas;
          this.updateCharts();
        },
        handleIntervalCanvasMounted(canvas) {
          this.intervalCanvas = canvas;
          this.updateCharts();
        },
        handleWordCanvasUnmounted() {
          extensionLog("Word canvas unmounted, cleaning up");
          this.wordCanvas = null;
          this.wordChartRendered = false;
        },
        handleDueCanvasUnmounted() {
          extensionLog("Due canvas unmounted, cleaning up");
          this.dueCanvas = null;
          this.dueChartRendered = false;
        },
        handleIntervalCanvasUnmounted() {
          extensionLog("Interval canvas unmounted, cleaning up");
          this.intervalCanvas = null;
          this.intervalChartRendered = false;
        },
        updateCharts() {
          this.debouncedUpdateCharts();
        },
        renderCharts() {
          this.renderWordChart();
          this.renderDueChart();
          this.renderIntervalChart();
        },
        renderWordChart() {
          if (this.wordChartRendered || !this.wordCanvas || !this.wordStats) {
            return;
          }
          
          this.wordChartRendered = true;
          
          ChartManager.createWordChart(
            this.wordCanvas,
            this.wordStats,
            extensionLog
          );
        },
        renderDueChart() {
          if (this.dueChartRendered || !this.dueCanvas || !this.dueStats) {
            return;
          }
          
          this.dueChartRendered = true;
          
          ChartManager.createDueChart(
            this.dueCanvas,
            this.dueStats,
            extensionLog
          );
        },
        renderIntervalChart() {
          if (this.intervalChartRendered || !this.intervalCanvas || !this.intervalStats) {
            return;
          }
          
          this.intervalChartRendered = true;
          
          ChartManager.createIntervalChart(
            this.intervalCanvas,
            this.intervalStats,
            extensionLog
          );
        },
        debouncedUpdateCharts: debounce(function() {
          extensionLog("Debounced chart update triggered");
          
          this.wordChartRendered = false;
          this.dueChartRendered = false;
          this.intervalChartRendered = false;
          
          this.$nextTick(() => {
            ChartManager.updateCharts({
              wordCanvas: this.wordCanvas,
              dueCanvas: this.dueCanvas,
              intervalCanvas: this.intervalCanvas,
              wordStats: this.wordStats,
              dueStats: this.dueStats,
              intervalStats: this.intervalStats,
              logFn: extensionLog,
              onComplete: (results) => {
                this.wordChartRendered = results.wordChartSuccess;
                this.dueChartRendered = results.dueChartSuccess;
                this.intervalChartRendered = results.intervalChartSuccess;
              }
            });
          });
        }, 300),
        updateChartsWithTheme() {
          this.currentTheme = getCurrentTheme();
          this.debouncedUpdateCharts();
        },
        updateData(newData) {
          extensionLog("Updating Vue component data", newData);
          
          if (newData.wordStats !== undefined) {
            this.wordStats = newData.wordStats;
          }
          if (newData.dueStats !== undefined) {
            this.dueStats = newData.dueStats;
          }
          if (newData.intervalStats !== undefined) {
            this.intervalStats = newData.intervalStats;
          }
          if (newData.availableDecks !== undefined) {
            this.availableDecks = newData.availableDecks;
          }
          if (newData.selectedDeckId !== undefined) {
            this.selectedDeckId = newData.selectedDeckId;
          }
          if (newData.selectedLanguage !== undefined) {
            this.selectedLanguage = newData.selectedLanguage;
          }
          if (newData.message !== undefined) {
            this.message = newData.message;
          }
          if (newData.isError !== undefined) {
            this.isError = newData.isError;
          }
        }
      },
      watch: {
        wordStats: {
          handler() {
            extensionLog("wordStats changed, scheduling chart update");
            this.wordChartRendered = false;
            this.$nextTick(this.debouncedUpdateCharts);
          },
          deep: true
        },
        dueStats: {
          handler() {
            extensionLog("dueStats changed, scheduling chart update");
            this.dueChartRendered = false;
            this.$nextTick(this.debouncedUpdateCharts);
          },
          deep: true
        },
        intervalStats: {
          handler() {
            extensionLog("intervalStats changed, scheduling chart update");
            this.intervalChartRendered = false;
            this.$nextTick(this.debouncedUpdateCharts);
          },
          deep: true
        },
        currentTheme() {
          extensionLog("Theme changed, scheduling chart update");
          this.wordChartRendered = false;
          this.dueChartRendered = false;
          this.intervalChartRendered = false;
          this.$nextTick(this.debouncedUpdateCharts);
        },
        selectedLanguage(newLang, oldLang) {
          if (newLang !== oldLang) {
            extensionLog(`Language changed in component from ${oldLang} to ${newLang}, resetting charts`);
            ChartManager.resetCharts();
            this.wordCanvas = null;
            this.dueCanvas = null;
            this.wordChartRendered = false;
            this.dueChartRendered = false;
            this.intervalChartRendered = false;
          }
        }
      },
      mounted() {
        extensionLog("Vue component mounted");
        
        extensionLog("Scheduling initial chart creation");
        this.$nextTick(() => {
          this.debouncedUpdateCharts();
        });
      },
      beforeUnmount() {
        ChartManager.destroyCharts();
        this.wordCanvas = null;
        this.dueCanvas = null;
        this.intervalCanvas = null;
      },
      template: `
        <div class="MCS__container" :class="{'UiCard -lesson Statistic__card': isError || message}">
          <template v-if="isError || message">
            <message-card 
              :is-error="isError" 
              :message="message" 
              :component-hash="componentHash" 
            />
          </template>
          <template v-else>
            <h2 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading2 -heading Statistic__title">Migaku Custom Stats</h2>
            <div v-bind:[componentHash]="true" class="UiCard -lesson Statistic__card">
              <!-- Deck Selector -->
              <deck-selector 
                :available-decks="availableDecks" 
                :selected-deck-id="selectedDeckId" 
                :component-hash="componentHash"
                @deck-selected="handleDeckSelected" 
              />
              
              <!-- Word Stats -->
              <word-stats-card 
                :word-stats="wordStats" 
                :component-hash="componentHash" 
                chart-ref="wordChart"
                @canvas-mounted="handleWordCanvasMounted"
                @canvas-unmounted="handleWordCanvasUnmounted"
              />
              
              <!-- Due Stats -->
              <due-stats-card 
                :due-stats="dueStats" 
                :component-hash="componentHash" 
                chart-ref="dueChart"
                @canvas-mounted="handleDueCanvasMounted"
                @canvas-unmounted="handleDueCanvasUnmounted"
              />
              
              <!-- Interval Stats -->
              <interval-stats-card 
                :interval-stats="intervalStats" 
                :component-hash="componentHash" 
                chart-ref="intervalChart"
                @canvas-mounted="handleIntervalCanvasMounted"
                @canvas-unmounted="handleIntervalCanvasUnmounted"
              />
            </div>
          </template>
        </div>
      `
    });

    try {
      extensionLog("Mounting Vue app");
      const vueApp = app.mount('#migaku-custom-stats-vue-container');
      extensionLog("Vue app mounted successfully.");

      if (!isError && !message) {
        extensionLog("Initializing charts");
        vueApp.debouncedUpdateCharts();
      }
      
      appState.themeChangeObserver = new MutationObserver((mutationsList) => {
        for (const mutation of mutationsList) {
          if (
            mutation.type === "attributes" &&
            mutation.attributeName === ATTRIBUTES.THEME
          ) {
            extensionLog("Theme changed, updating charts with new theme colors");
            
            if (vueApp) {
              try {
                vueApp.updateChartsWithTheme();
              } catch (themeUpdateError) {
                extensionLog("Error updating charts after theme change:", themeUpdateError);
              }
            }
            
            break;
          }
        }
      });
      
      appState.themeChangeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: [ATTRIBUTES.THEME],
      });
      
      return vueApp;
    } catch (vueError) {
      extensionLog("Error mounting Vue app:", vueError);
      const errorDiv = document.createElement('div');
      errorDiv.id = SELECTORS.ERROR_CONTAINER_ID;
      errorDiv.innerHTML = `<p>Error mounting Vue application: ${vueError.message}</p>`;
      statsContainer.appendChild(errorDiv);
      return null;
    }
  }

  function runFilteredStatsQuery(vueInstance) {
    const selectedDeck = dbState.availableDecks.find((d) => d.id === appState.selectedDeckId);
    const deckName = selectedDeck ? selectedDeck.name : UI_TEXTS.ALL_DECKS;
    extensionLog(`Refreshing data for deck: ${deckName} (ID: ${appState.selectedDeckId})`);

    if (appState.isProcessing) {
      extensionLog("Stats refresh already in progress, skipping.");
      return;
    }

    appState.isProcessing = true;

    initDB()
      .then((db) => accessMigakuData(db, vueInstance))
      .catch((err) => {
        extensionLog("Error refreshing data:", err);
        
        const errorMessage = `Error refreshing statistics: ${err.message}. Please try again later.`;
        
        if (vueInstance) {
          vueInstance.updateData({
            wordStats: null,
            dueStats: null,
            intervalStats: null,
            message: errorMessage,
            isError: true
          });
        } else {
          displayCustomStats(errorMessage);
        }
      })
      .finally(() => {
        appState.isProcessing = false;
      });
  }

  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;

  history.pushState = function () {
    const previousPath = appState.previousRoute;
    const result = originalPushState.apply(this, arguments);
    const currentPath = window.location.pathname;
    appState.previousRoute = currentPath;
    
    extensionLog(`Route changed from ${previousPath} to ${currentPath}`);
    
    if (currentPath === statsRoute && previousPath !== statsRoute) {
      extensionLog("Entering statistics page, resetting charts");
      ChartManager.resetCharts();
    }
    
    setTimeout(runStatsLogic, 0);
    return result;
  };

  history.replaceState = function () {
    const previousPath = appState.previousRoute;
    const result = originalReplaceState.apply(this, arguments);
    const currentPath = window.location.pathname;
    appState.previousRoute = currentPath;
    
    extensionLog(`Route replaced from ${previousPath} to ${currentPath}`);
    
    if (currentPath === statsRoute && previousPath !== statsRoute) {
      extensionLog("Entering statistics page, resetting charts");
      ChartManager.resetCharts();
    }
    
    setTimeout(runStatsLogic, 0);
    return result;
  };

  window.addEventListener("popstate", () => {
    const previousPath = appState.previousRoute;
    const currentPath = window.location.pathname;
    appState.previousRoute = currentPath;
    
    extensionLog(`Route popped from ${previousPath} to ${currentPath}`);
    
    if (currentPath === statsRoute && previousPath !== statsRoute) {
      extensionLog("Entering statistics page, resetting charts");
      ChartManager.resetCharts();
    }
    
    runStatsLogic();
  });

  extensionLog("Migaku Custom Stats Script Initializing...");
  runStatsLogic();
})();
