// ==UserScript==
// @name         Migaku Custom Stats
// @namespace    http://tampermonkey.net/
// @version      0.1.27
// @description  Custom stats for Migaku Memory.
// @author       sguadalupe
// @license      GPL-3.0
// @match        https://study.migaku.com/*
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
    IGNORED: "IGNORED"
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
          WHERE w.language = ? AND w.del = 0 AND d.id = ? AND c.del = 0
      ) as w`,
    DUE_QUERY: `
      SELECT
        due,
        COUNT(*) as count
      FROM card c
      JOIN card_type ct ON c.cardTypeId = ct.id
      WHERE ct.lang = ? AND c.due BETWEEN ? AND ? AND c.del = 0`,
    INTERVAL_QUERY: `
      SELECT
        interval as interval_group,
        COUNT(*) as count
      FROM card c
      JOIN card_type ct ON c.cardTypeId = ct.id
      WHERE ct.lang = ? AND c.del = 0 AND c.interval > 0
      GROUP BY interval_group
      ORDER BY interval_group`,
    REVIEW_HISTORY_QUERY: `
      SELECT 
        r.day,
        r.type,
        COUNT(DISTINCT r.cardId) as review_count
      FROM review r
      JOIN card c ON r.cardId = c.id
      JOIN card_type ct ON c.cardTypeId = ct.id
      JOIN reviewHistory rh ON r.day = rh.day
      WHERE ct.lang = ? AND r.day >= ? AND r.del = 0
      GROUP BY r.day, r.type
      ORDER BY r.day DESC, r.type`,
    STUDY_STATS_QUERY: `
      SELECT 
        COUNT(DISTINCT r.day) as days_studied,
        COUNT(*) as total_reviews,
        ROUND(COUNT(*) * 1.0 / COUNT(DISTINCT r.day), 1) as avg_reviews_per_day
      FROM review r
      JOIN card c ON r.cardId = c.id
      JOIN card_type ct ON c.cardTypeId = ct.id
      WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND r.del = 0`,
    CURRENT_DATE_QUERY: `
      SELECT entry 
      FROM keyValue
      WHERE key = 'study.activeDay.currentDate';`,
    PASS_RATE_QUERY: `
        SELECT 
          SUM(CASE WHEN r.type = 2 THEN 1 ELSE 0 END) as successful_reviews,
          SUM(CASE WHEN r.type = 1 THEN 1 ELSE 0 END) as failed_reviews
        FROM review r
        JOIN card c ON r.cardId = c.id
        JOIN card_type ct ON c.cardTypeId = ct.id
        WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND r.del = 0 AND r.type IN (1, 2);`
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
    lastReviewStats: null,
    lastStudyStats: null,
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
        display: flex;
        flex-direction: column;
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
    
    .MCS__reviewchart {
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
    
    .MCS__study-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        margin: 16px 0;
    }

    @media (max-width: 1280px) {
      .MCS__study-stats {
        grid-template-columns: repeat(2, 1fr);
      }
    }
    
    .MCS__stat-box {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 16px;
        background: rgba(0, 199, 164, 0.05);
        border-radius: 8px;
    }
    
    .MCS__stat-value {
        font-size: 24px;
        font-weight: bold;
        margin-bottom: 8px;
    }
    
    .MCS__stat-label {
        font-size: 14px;
        text-align: center;
    }

    .MCS__deck-selector {
        margin: 16px 0;
    }
    
    canvas {
        display: block;
        position: absolute;
        top: 0;
        left: 0;
    }

    .MCS__header-selector {
      margin-left: auto;
    }
    .Statistic__card__header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .MCS__radio-group {
      display: flex;
      align-items: center;
      padding: 8px 0;
      justify-content: space-around;
    }

    .MCS__radio-button {
      width: 24px;
      height: 24px;
      background-position: center;
      background-repeat: no-repeat;
      background-size: 16px 16px;
      border-radius: 50%;
      position: relative;
    }

    .MCS__radio-button.-toggled {
      background: none;
    }

    .MCS__radio-button.-toggled::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background-image: linear-gradient(180deg,var(--primary-gradient-1),var(--primary-gradient-2));
    }

    @media (min-width: 1280px) {
      .MCS__stats-container {
        display: grid;
        grid-template-areas:
          "gridTitle customStats"
          "gridContainer customStats";
        grid-template-rows: auto 1fr;
        align-items: start;
        justify-content: center;
        column-gap: 32px;
      }
    }

    .UiTypo.UiTypo__heading2.-heading.Statistic__title {
      grid-area: gridTitle;
    }

    .UiCard.-lesson.Statistic__card {
      grid-area: gridContainer;
    }

    #migaku-custom-stats-vue-container {
      grid-area: customStats;
    }

    @media (max-width: 1280px) {
      .CustomStats__title {
        margin-top: 32px !important;
      }
    }
    `;

  const themeConfigs = {
    dark: {
      backgroundElevation1: "#202047",
      backgroundElevation2: "#2b2b60",
      accent1: "rgba(178, 114, 255, 1)",
      accent2: "#fe4670",
      accent3: "#fba335",
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
      accent2: "#fe4670",
      accent3: "#ff9345",
      accent1Transparent: "rgba(103, 47, 195, 0.12)",
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
    reviewChartInstance: null,
    
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
                color: themeColors.textColor,
                usePointStyle: true,
                pointStyle: 'circle'
              }
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
     * Updates or creates a review history bar chart
     * @param {HTMLCanvasElement} canvas - The canvas element to render on
     * @param {Object} reviewStats - The review statistics data
     * @param {Function} logFn - Logging function
     * @returns {Object|null} - Chart instance or null if failed
     */
    createReviewHistoryChart(canvas, reviewStats, logFn) {
      if (!canvas) {
        logFn("Review history chart creation aborted: canvas is undefined");
        return null;
      }
      
      if (!reviewStats || !reviewStats.labels || !reviewStats.counts) {
        logFn("Review history chart creation aborted: reviewStats data is missing", reviewStats);
        return null;
      }
      
      const themeColors = getThemeColors();
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        logFn("Failed to get review history chart canvas context");
        return null;
      }
      
      const chartConfig = {
        type: 'bar',
        data: {
          labels: reviewStats.labels,
          datasets: [
            {
              label: reviewStats.typeLabels[0],
              data: reviewStats.counts[0],
              backgroundColor: themeColors.accent1,
              borderWidth: 0,
              borderRadius: 4,
              order: 3
            },
            {
              label: reviewStats.typeLabels[1],
              data: reviewStats.counts[1],
              backgroundColor: themeColors.accent2,
              borderWidth: 0,
              borderRadius: 4,
              order: 2
            },
            {
              label: reviewStats.typeLabels[2],
              data: reviewStats.counts[2],
              backgroundColor: themeColors.accent3,
              borderWidth: 0,
              borderRadius: 4,
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
              stacked: true,
              title: {
                display: true,
                text: 'Number of Reviews',
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
            x: {
              stacked: true,
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
                usePointStyle: true,
                pointStyle: 'circle'
              }
            },
            tooltip: {
              mode: 'index',
              callbacks: {
                title: function(tooltipItems) {
                  return tooltipItems[0].label;
                },
                label: function(context) {
                  const value = context.parsed.y;
                  return `${context.dataset.label}: ${value}`;
                },
                footer: function(tooltipItems) {
                  const total = tooltipItems.reduce((sum, item) => sum + item.parsed.y, 0);
                  return `Total: ${total}`;
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
              footerColor: themeColors.textColor,
              titleColor: themeColors.textColor,
            }
          },
        }
      };
      
      try {
        if (this.reviewChartInstance) {
          logFn("Updating existing review history chart with new data");
          
          this.reviewChartInstance.data.labels = reviewStats.labels;
          this.reviewChartInstance.data.datasets[0].data = reviewStats.counts[0];
          this.reviewChartInstance.data.datasets[1].data = reviewStats.counts[1];
          this.reviewChartInstance.data.datasets[2].data = reviewStats.counts[2];
          this.reviewChartInstance.data.datasets[0].backgroundColor = themeColors.accent1;
          this.reviewChartInstance.data.datasets[1].backgroundColor = themeColors.accent2;
          this.reviewChartInstance.data.datasets[2].backgroundColor = themeColors.accent3;
          
          this.reviewChartInstance.options.scales.y.ticks.color = themeColors.textColor;
          this.reviewChartInstance.options.scales.y.title.color = themeColors.textColor;
          this.reviewChartInstance.options.scales.y.grid.color = themeColors.gridColor;
          this.reviewChartInstance.options.scales.x.ticks.color = themeColors.textColor;
          this.reviewChartInstance.options.scales.x.title.color = themeColors.textColor;
          this.reviewChartInstance.options.scales.x.grid.color = themeColors.gridColor;
          this.reviewChartInstance.options.plugins.tooltip.backgroundColor = themeColors.backgroundElevation2;
          this.reviewChartInstance.options.plugins.tooltip.bodyColor = themeColors.textColor;
          this.reviewChartInstance.options.plugins.tooltip.titleColor = themeColors.textColor;
          this.reviewChartInstance.options.plugins.tooltip.footerColor = themeColors.textColor;
          this.reviewChartInstance.options.plugins.legend.labels.color = themeColors.textColor;
          
          this.reviewChartInstance.update();
          return this.reviewChartInstance;
        }
        
        this.reviewChartInstance = new Chart(ctx, chartConfig);
        logFn("Review history chart created successfully");
        return this.reviewChartInstance;
      } catch (error) {
        logFn("Error in review history chart creation/update:", error);
        
        try {
          if (this.reviewChartInstance) {
            this.reviewChartInstance.destroy();
          }
          this.reviewChartInstance = new Chart(ctx, chartConfig);
          logFn("Review history chart recreated after error");
          return this.reviewChartInstance;
        } catch (recreateError) {
          logFn("Failed to recreate review history chart:", recreateError);
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
                usePointStyle: true,
                pointStyle: 'circle'
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
          
          const newCumulativeCounts = [];
          let newRunningSum = 0;
          for (let i = 0; i < dueStats.counts.length; i++) {
            newRunningSum += dueStats.counts[i];
            newCumulativeCounts.push(newRunningSum);
          }
          
          this.dueChartInstance.data.labels = dueStats.labels;
          this.dueChartInstance.data.datasets[0].data = dueStats.counts;
          
          if (this.dueChartInstance.data.datasets.length > 1) {
            this.dueChartInstance.data.datasets[1].data = newCumulativeCounts;
            this.dueChartInstance.data.datasets[1].borderColor = themeColors.unknownColor;
            this.dueChartInstance.data.datasets[1].backgroundColor = themeColors.unknownColor;
          } else {
            this.dueChartInstance.data.datasets.push({
              label: 'Cumulative Cards',
              data: newCumulativeCounts,
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
          
          const finalTotal = newCumulativeCounts[newCumulativeCounts.length - 1];
          this.dueChartInstance.options.plugins.tooltip.callbacks.label = function(context) {
            const datasetLabel = context.dataset.label || '';
            const value = context.parsed.y;
            
            if (datasetLabel === 'Cards Due' && value > 0) {
              const percentage = finalTotal > 0 ? ((value / finalTotal) * 100).toFixed(1) : '0.0';
              return `${datasetLabel}: ${value} (${percentage}%)`;
            }
            
            if (datasetLabel === 'Cumulative Cards') {
              const percentage = finalTotal > 0 ? ((value / finalTotal) * 100).toFixed(1) : '0.0';
              return `${datasetLabel}: ${value} (${percentage}%)`;
            }
            
            return `${datasetLabel}: ${value}`;
          };
          
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
                usePointStyle: true,
                pointStyle: 'circle'
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
          
          this.intervalChartInstance.options.plugins.tooltip.callbacks = {
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
          };
          
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
     * @param {HTMLCanvasElement} options.reviewCanvas - Review history chart canvas
     * @param {Object} options.wordStats - Word statistics data
     * @param {Object} options.dueStats - Due statistics data
     * @param {Object} options.intervalStats - Interval statistics data
     * @param {Object} options.reviewStats - Review history statistics data
     * @param {Function} options.onComplete - Callback after charts are rendered
     * @param {Function} options.logFn - Logging function
     */
    updateCharts(options) {
      const { wordCanvas, dueCanvas, intervalCanvas, reviewCanvas, wordStats, dueStats, intervalStats, reviewStats, onComplete, logFn } = options;
      
      logFn("Chart update triggered");
      
      let wordChartSuccess = false;
      let dueChartSuccess = false;
      let intervalChartSuccess = false;
      let reviewChartSuccess = false;
      
      if (wordCanvas && wordStats) {
        wordChartSuccess = !!this.createWordChart(wordCanvas, wordStats, logFn);
      }
      
      if (dueCanvas && dueStats && dueStats.labels && dueStats.counts) {
        dueChartSuccess = !!this.createDueChart(dueCanvas, dueStats, logFn);
      }
      
      if (intervalCanvas && intervalStats && intervalStats.labels && intervalStats.counts) {
        intervalChartSuccess = !!this.createIntervalChart(intervalCanvas, intervalStats, logFn);
      }
      
      if (reviewCanvas && reviewStats && reviewStats.labels && reviewStats.counts) {
        reviewChartSuccess = !!this.createReviewHistoryChart(reviewCanvas, reviewStats, logFn);
      }
      
      if (onComplete) {
        onComplete({
          wordChartSuccess,
          dueChartSuccess,
          intervalChartSuccess,
          reviewChartSuccess
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
      
      if (this.reviewChartInstance) {
        try {
          this.reviewChartInstance.destroy();
          this.reviewChartInstance = null;
        } catch (e) {
          console.error("Error destroying review chart instance:", e);
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
      dbState.lastReviewStats = null;
      dbState.lastStudyStats = null;
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
      dbState.lastWordStats = null;
      dbState.lastDueStats = null;
      dbState.lastIntervalStats = null;
      dbState.lastReviewStats = null;
      dbState.lastStudyStats = null;
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
      dbState.lastReviewStats = null;
      dbState.lastStudyStats = null;
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
   * @param {Date} currentDate - The current date fetched from the database
   * @param {number} currentDayNumber - The current day number relative to the start date
   * @param {string} dueStatsPeriod - Period ID (default: "dueStats1")
   * @returns {Object|null} - Due cards statistics or null if failed
   */
  function fetchDueStats(dbInstance, language, deckId, logFn, currentDate, currentDayNumber, dueStatsPeriod = "dueStats1") {
    try {
      let forecastDays;
      const period = dueStatsPeriod.replace("dueStats", "");
      
      if (period === "All") {
        forecastDays = 3650;
      } else {
        const periodMonths = parseInt(period, 10) || 1;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const forecastEndDate = new Date(today);
        
        forecastEndDate.setMonth(today.getMonth() + periodMonths);
        
        forecastDays = Math.round((forecastEndDate - today) / (1000 * 60 * 60 * 24));
      }
      
      let endDayNumber;
      if (dueStatsPeriod === "dueStatsAll") {
        let maxDueQuery = `SELECT MAX(due) as maxDue FROM card c
                          JOIN card_type ct ON c.cardTypeId = ct.id
                          WHERE ct.lang = ? AND c.due >= ? AND c.del = 0`;
        let maxDueParams = [language, currentDayNumber];
        
        if (deckId !== SETTINGS.DEFAULT_DECK_ID) {
          maxDueQuery += " AND c.deckId = ?";
          maxDueParams.push(deckId);
        }
        
        const maxDueResults = dbInstance.exec(maxDueQuery, maxDueParams);
        
        if (maxDueResults.length > 0 && maxDueResults[0].values.length > 0 && maxDueResults[0].values[0][0] !== null) {
          endDayNumber = maxDueResults[0].values[0][0];
          logFn(`Found max due day: ${endDayNumber}`);
        } else {
          endDayNumber = currentDayNumber + forecastDays - 1;
          logFn(`No max due day found, using default: ${endDayNumber}`);
        }
      } else {
        endDayNumber = currentDayNumber + (forecastDays - 1);
      }
      
      logFn(`Calculating due cards between day ${currentDayNumber} and ${endDayNumber}`);
      
      const actualForecastDays = endDayNumber - currentDayNumber + 1;
      
      let dueQuery = SQL_QUERIES.DUE_QUERY;
      let dueQueryParams = [language, currentDayNumber, endDayNumber];
      
      if (deckId !== SETTINGS.DEFAULT_DECK_ID) {
        dueQuery += " AND c.deckId = ?";
        dueQueryParams.push(deckId);
      }
      
      dueQuery += " GROUP BY due ORDER BY due";
      
      const dueResults = dbInstance.exec(dueQuery, dueQueryParams);
      
      const dateLabels = [];
      const dateCounts = [];
      const tempDate = new Date(currentDate);
      
      for (let i = 0; i < actualForecastDays; i++) {
        let label = tempDate.toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric"
        });
        if (SETTINGS.ENVIRONMENT === "dev") {
          label += ` (${currentDayNumber + i})`;
        }
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
        
        for (let i = 0; i < actualForecastDays; i++) {
          const dayNum = currentDayNumber + i;
          if (dueCountsByDay[dayNum]) {
            dateCounts[i] = dueCountsByDay[dayNum];
          }
        }
        
        if (dueStatsPeriod === "dueStatsAll") {
          let lastNonZeroIndex = dateCounts.length - 1;
          while (lastNonZeroIndex >= 0 && dateCounts[lastNonZeroIndex] === 0) {
            lastNonZeroIndex--;
          }
          
          const extraDays = 5;
          lastNonZeroIndex = Math.min(lastNonZeroIndex + extraDays, dateCounts.length - 1);
          
          if (lastNonZeroIndex >= 0) {
            dateLabels.splice(lastNonZeroIndex + 1);
            dateCounts.splice(lastNonZeroIndex + 1);
            logFn(`Trimmed data to ${lastNonZeroIndex + 1} days`);
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
   * @param {string} percentileId - Percentile ID (default: "intervalPercentile75")
   * @returns {Object|null} - Interval statistics or null if failed
   */
  function fetchIntervalStats(dbInstance, language, deckId, logFn, percentileId = "intervalPercentile75") {
    try {
      const percentile = percentileId.replace("intervalPercentile", "");
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
        
        const cutoffPercentile = percentile / 100;
        let cumulativeCount = 0;
        let cutoffInterval = maxInterval;
        
        const sortedIntervals = Array.from(intervalMap.keys()).sort((a, b) => a - b);
        
        for (const interval of sortedIntervals) {
          cumulativeCount += intervalMap.get(interval);
          const percentileValue = cumulativeCount / totalCards;
          
          if (percentileValue >= cutoffPercentile) {
            cutoffInterval = interval;
            break;
          }
        }
        
        logFn(`Excluding intervals beyond ${cutoffInterval} days (${percentile}th percentile)`);
        
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

  /**
   * Fetches review history statistics for the selected language and deck
   * @param {Object} dbInstance - SQL.js database instance
   * @param {string} language - Selected language
   * @param {string} deckId - Selected deck ID
   * @param {Function} logFn - Logging function
   * @param {Date} currentDate - The current date fetched from the database
   * @param {number} currentDayNumber - The current day number relative to the start date
   * @param {string} periodId - Period ID (default: "reviewHistory1")
   * @param {string} grouping - Time grouping ('Days', 'Weeks', 'Months', default: 'Days')
   * @returns {Object|null} - Review history statistics or null if failed
   */
  function fetchReviewHistory(dbInstance, language, deckId, logFn, currentDate, currentDayNumber, periodId = "reviewHistory1", grouping = "Days") {
    try {
      const period = periodId.replace("reviewHistory", "");
      const startDate = new Date(CHART_CONFIG.START_YEAR, CHART_CONFIG.START_MONTH, CHART_CONFIG.START_DAY);
      
      let periodDays;
      if (period === "All") {
        periodDays = currentDayNumber;
      } else {
        const periodMonths = parseInt(period, 10) || 1;
        const periodStartDate = new Date(currentDate);
        periodStartDate.setMonth(currentDate.getMonth() - periodMonths);
        periodDays = Math.round((currentDate - periodStartDate) / (1000 * 60 * 60 * 24)) + 1;
      }
      
      const periodDaysAgoDayNumber = currentDayNumber - periodDays;
      
      logFn(`Fetching review history since day ${periodDaysAgoDayNumber} (${periodDays} days ago), grouped by ${grouping}`);
      
      let reviewQuery = SQL_QUERIES.REVIEW_HISTORY_QUERY;
      let reviewQueryParams = [language, periodDaysAgoDayNumber];
      
      if (deckId !== SETTINGS.DEFAULT_DECK_ID) {
        reviewQuery = reviewQuery.replace(
          "WHERE ct.lang = ? AND r.day >= ? AND r.del = 0", 
          "WHERE ct.lang = ? AND r.day >= ? AND r.del = 0 AND c.deckId = ?"
        );
        reviewQueryParams.push(deckId);
      }
      
      const reviewResults = dbInstance.exec(reviewQuery, reviewQueryParams);
      
      const dateLabels = [];
      const type0Counts = [];
      const type1Counts = [];
      const type2Counts = [];
      const dayMap = new Map();
      const aggregateMap = new Map();
      
      let actualPeriodDays = periodDays;
      if (period === "All" && reviewResults.length > 0 && reviewResults[0].values.length > 0) {
        let earliestDayWithReviews = currentDayNumber;
        reviewResults[0].values.forEach(row => {
          const dayNumber = row[0];
          earliestDayWithReviews = Math.min(earliestDayWithReviews, dayNumber);
        });
        
        const daysWithData = currentDayNumber - earliestDayWithReviews + 1;
        actualPeriodDays = Math.min(periodDays, daysWithData);
        logFn(`Found earliest day with reviews: ${earliestDayWithReviews}, using period: ${actualPeriodDays} days`);
      }
      
      let currentGroupKey = null;
      let groupIndex = -1;
      for (let i = 0; i < actualPeriodDays; i++) {
        const dayNumber = currentDayNumber - (actualPeriodDays - 1 - i);
        const date = new Date(startDate);
        date.setDate(date.getDate() + dayNumber);
        date.setHours(0, 0, 0, 0);
        
        let displayDate;
        let groupKey;
        
        if (grouping === 'Weeks') {
          const dayOfWeek = (date.getDay() + 6) % 7;
          const weekStartDate = new Date(date);
          weekStartDate.setDate(date.getDate() - dayOfWeek);
          groupKey = weekStartDate.toISOString().split('T')[0];
          
          if (groupKey !== currentGroupKey) {
            displayDate = weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
            dateLabels.push(`Week of ${displayDate}`);
            type0Counts.push(0);
            type1Counts.push(0);
            type2Counts.push(0);
            currentGroupKey = groupKey;
            groupIndex++;
            aggregateMap.set(groupKey, { index: groupIndex, data: [0, 0, 0] });
          }
        } else if (grouping === 'Months') {
          groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          
          if (groupKey !== currentGroupKey) {
            displayDate = date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
            dateLabels.push(displayDate);
            type0Counts.push(0);
            type1Counts.push(0);
            type2Counts.push(0);
            currentGroupKey = groupKey;
            groupIndex++;
            aggregateMap.set(groupKey, { index: groupIndex, data: [0, 0, 0] });
          }
        } else {
          groupKey = dayNumber;
          displayDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          if (SETTINGS.ENVIRONMENT === "dev") {
            displayDate += ` (${dayNumber})`;
          }
          dateLabels.push(displayDate);
          type0Counts.push(0);
          type1Counts.push(0);
          type2Counts.push(0);
          dayMap.set(dayNumber, { index: i });
        }
      }
      
      if (reviewResults.length > 0 && reviewResults[0].values.length > 0) {
        logFn("Review history query results:", reviewResults[0]);
        
        reviewResults[0].values.forEach(row => {
          const dayNumber = row[0];
          const reviewType = row[1];
          const count = row[2];
          const date = new Date(startDate);
          date.setDate(date.getDate() + dayNumber);
          date.setHours(0, 0, 0, 0);
          
          let targetIndex = -1;
          let targetMapEntry = null;
          
          if (grouping === 'Weeks') {
            const dayOfWeek = (date.getDay() + 6) % 7;
            const weekStartDate = new Date(date);
            weekStartDate.setDate(date.getDate() - dayOfWeek);
            const groupKey = weekStartDate.toISOString().split('T')[0];
            if (aggregateMap.has(groupKey)) {
               targetMapEntry = aggregateMap.get(groupKey);
               targetIndex = targetMapEntry.index;
            }
          } else if (grouping === 'Months') {
            const groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (aggregateMap.has(groupKey)) {
              targetMapEntry = aggregateMap.get(groupKey);
              targetIndex = targetMapEntry.index;
            }
          } else {
            if (dayMap.has(dayNumber)) {
              targetIndex = dayMap.get(dayNumber).index;
            }
          }
          
          if (targetIndex !== -1) {
            if (reviewType === 0) {
               if (grouping === 'Days') type0Counts[targetIndex] += count; else targetMapEntry.data[0] += count;
            } else if (reviewType === 1) {
               if (grouping === 'Days') type1Counts[targetIndex] += count; else targetMapEntry.data[1] += count;
            } else if (reviewType === 2) {
               if (grouping === 'Days') type2Counts[targetIndex] += count; else targetMapEntry.data[2] += count;
            }
          }
        });
        
        if (grouping === 'Weeks' || grouping === 'Months') {
            aggregateMap.forEach(entry => {
                type0Counts[entry.index] = entry.data[0];
                type1Counts[entry.index] = entry.data[1];
                type2Counts[entry.index] = entry.data[2];
            });
        }
        
      } else {
        logFn("Review history query returned no results");
      }
      
      return { 
        labels: dateLabels, 
        counts: [type0Counts, type1Counts, type2Counts],
        typeLabels: ['New cards', 'Failed reviews', 'Successful reviews']
      };
    } catch (error) {
      logFn("Error fetching review history:", error);
      return null;
    }
  }
  
  /**
   * Fetches study statistics for the selected language and deck
   * @param {Object} dbInstance - SQL.js database instance
   * @param {string} language - Selected language
   * @param {string} deckId - Selected deck ID
   * @param {Function} logFn - Logging function
   * @param {number} currentDayNumber - The current day number relative to the start date
   * @param {string} periodId - Period ID (default: "studyStats1")
   * @returns {Object|null} - Study statistics or null if failed
   */
  function fetchStudyStats(dbInstance, language, deckId, logFn, currentDayNumber, periodId = "studyStats1") {
    try {
      const period = periodId.replace("studyStats", "");
      const startDate = new Date(CHART_CONFIG.START_YEAR, CHART_CONFIG.START_MONTH, CHART_CONFIG.START_DAY);
      
      let periodDays;
      let startDayNumber;
      let earliestReviewDayForAllTime = null;

      if (period === "All") {
        let earliestReviewQuery = `SELECT MIN(r.day) as minDay 
                                   FROM review r 
                                   JOIN card c ON r.cardId = c.id 
                                   JOIN card_type ct ON c.cardTypeId = ct.id 
                                   WHERE ct.lang = ? AND r.del = 0`;
        
        let earliestReviewParams = [language];
        
        if (deckId !== SETTINGS.DEFAULT_DECK_ID) {
          earliestReviewQuery += " AND c.deckId = ?";
          earliestReviewParams.push(deckId);
        }
        
        const earliestReviewResults = dbInstance.exec(earliestReviewQuery, earliestReviewParams);
        
        if (earliestReviewResults.length > 0 && 
            earliestReviewResults[0].values.length > 0 && 
            earliestReviewResults[0].values[0][0] !== null) {
          earliestReviewDayForAllTime = earliestReviewResults[0].values[0][0];
          periodDays = currentDayNumber - earliestReviewDayForAllTime + 1;
          startDayNumber = earliestReviewDayForAllTime;
          logFn(`Found earliest review day (All time): ${earliestReviewDayForAllTime}, setting period to ${periodDays} days`);
        } else {
          periodDays = currentDayNumber + 1;
          startDayNumber = 0;
          logFn(`No earliest review day found (All time), using full period: ${periodDays} days`);
        }
      } else {
        const periodMonths = parseInt(period, 10) || 1;
        const today = new Date(startDate);
        today.setDate(today.getDate() + currentDayNumber);
        const periodStartDate = new Date(today);
        periodStartDate.setMonth(today.getMonth() - periodMonths);
        periodDays = Math.round((today - periodStartDate) / (1000 * 60 * 60 * 24)) + 1;
        startDayNumber = currentDayNumber - periodDays + 1;
        logFn(`Using fixed period: ${periodMonths} months (${periodDays} days), starting from day ${startDayNumber}`);
      }
      
      logFn(`Fetching study stats from day ${startDayNumber} to ${currentDayNumber}`);
      
      let studyQuery = SQL_QUERIES.STUDY_STATS_QUERY;
      let studyQueryParams = [language, startDayNumber, currentDayNumber];
      
      if (deckId !== SETTINGS.DEFAULT_DECK_ID) {
        studyQuery = studyQuery.replace(
          "AND r.del = 0", 
          "AND c.deckId = ? AND r.del = 0" 
        );
        studyQueryParams.push(deckId);
      }
      
      let passRateQuery = SQL_QUERIES.PASS_RATE_QUERY;
      let passRateQueryParams = [language, startDayNumber, currentDayNumber];
      
      if (deckId !== SETTINGS.DEFAULT_DECK_ID) {
        passRateQuery = passRateQuery.replace(
          "AND r.del = 0", 
          "AND c.deckId = ? AND r.del = 0" 
        );
        passRateQueryParams.push(deckId);
      }
      
      const studyResults = dbInstance.exec(studyQuery, studyQueryParams);
      const passRateResults = dbInstance.exec(passRateQuery, passRateQueryParams);
      
      if (studyResults.length > 0 && studyResults[0].values.length > 0) {
        logFn("Study stats query results:", studyResults[0]);
        
        const days_studied = studyResults[0].values[0][0] || 0;
        const total_reviews = studyResults[0].values[0][1] || 0;
        const avg_reviews_per_day = studyResults[0].values[0][2] || 0;

        let denominator;
        if (period === "All" && earliestReviewDayForAllTime !== null && days_studied > 0) {
          denominator = currentDayNumber - earliestReviewDayForAllTime + 1;
        } else {
           denominator = Math.max(1, periodDays);
        }

        logFn(`Days studied: ${days_studied}, Total reviews: ${total_reviews}, Avg reviews per day: ${avg_reviews_per_day}, Period days (calculated): ${periodDays}, Denominator for %: ${denominator}`);
        
        const daysStudiedPercent = Math.round((days_studied / denominator) * 100);
        
        let pass_rate = 0;
        if (passRateResults.length > 0 && passRateResults[0].values.length > 0) {
          const successful_reviews = passRateResults[0].values[0][0] || 0;
          const failed_reviews = passRateResults[0].values[0][1] || 0;
          const total_answered_reviews = successful_reviews + failed_reviews;
          
          if (total_answered_reviews > 0) {
            pass_rate = Math.round((successful_reviews / total_answered_reviews) * 100);
          }
          
          logFn(`Pass rate calculation: ${successful_reviews} successful of ${total_answered_reviews} total = ${pass_rate}%`);
        }
        
        return {
          days_studied,
          days_studied_percent: daysStudiedPercent,
          total_reviews,
          avg_reviews_per_day,
          period_days: periodDays,
          pass_rate
        };
      } else {
        logFn("Study stats query returned no results");
        return {
          days_studied: 0,
          days_studied_percent: 0,
          total_reviews: 0,
          avg_reviews_per_day: 0,
          period_days: periodDays,
          pass_rate: 0
        };
      }
    } catch (error) {
      logFn("Error fetching study stats:", error);
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
          reviewStats: null,
          studyStats: null,
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
            reviewStats: null,
            studyStats: null,
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
                reviewStats: null,
                studyStats: null,
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
                reviewStats: null,
                studyStats: null,
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
                reviewStats: null,
                studyStats: null,
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
            
            let currentDateString = null;
            let currentDate = new Date();
            currentDate.setHours(12, 0, 0, 0);
            let currentDayNumber = 0;
            const startDate = new Date(CHART_CONFIG.START_YEAR, CHART_CONFIG.START_MONTH, CHART_CONFIG.START_DAY, 12, 0, 0, 0);
            
            try {
              const dateResult = dbInstance.exec(SQL_QUERIES.CURRENT_DATE_QUERY);
              if (dateResult.length > 0 && dateResult[0].values.length > 0 && dateResult[0].values[0][0]) {
                currentDateString = dateResult[0].values[0][0];
                currentDate = new Date(currentDateString + 'T00:00:00');
                extensionLog("Fetched current date from DB:", currentDateString);
              } else {
                 extensionLog("Could not fetch current date from DB, falling back to system time.");
              }
            } catch (dateError) {
              extensionLog("Error fetching current date from DB, falling back to system time:", dateError);
            }
            currentDayNumber = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24)) + 1;
            
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
              extensionLog,
              currentDate,
              currentDayNumber,
              vueInstance ? vueInstance.selectedDuePeriod : "dueStats1"
            );
            
            const intervalData = fetchIntervalStats(
              dbInstance, 
              appState.selectedLanguage, 
              appState.selectedDeckId, 
              extensionLog,
              vueInstance ? vueInstance.selectedPercentile : "intervalPercentile75"
            );
            
            const reviewHistoryData = fetchReviewHistory(
              dbInstance,
              appState.selectedLanguage,
              appState.selectedDeckId,
              extensionLog,
              currentDate,
              currentDayNumber,
              vueInstance ? vueInstance.selectedPeriodReviewHistory : "reviewHistory1",
              vueInstance ? vueInstance.selectedReviewGrouping : "Days"
            );
            
            const studyStatsData = fetchStudyStats(
              dbInstance,
              appState.selectedLanguage,
              appState.selectedDeckId,
              extensionLog,
              currentDayNumber,
              vueInstance ? vueInstance.selectedPeriodStudyStats : "studyStats1"
            );

            dbState.lastWordStats = wordValues;
            dbState.lastDueStats = dueData;
            dbState.lastIntervalStats = intervalData;
            dbState.lastReviewStats = reviewHistoryData;
            dbState.lastStudyStats = studyStatsData;

            if (vueInstance) {
              vueInstance.updateData({
                wordStats: wordValues,
                dueStats: dueData,
                intervalStats: intervalData,
                reviewStats: reviewHistoryData,
                studyStats: studyStatsData,
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
                intervalStats: intervalData,
                reviewStats: reviewHistoryData,
                studyStats: studyStatsData
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
            dbState.lastReviewStats = null;
            dbState.lastStudyStats = null;
            
            if (vueInstance) {
              vueInstance.updateData({
                wordStats: null,
                dueStats: null,
                intervalStats: null,
                reviewStats: null,
                studyStats: null,
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
          dbState.lastReviewStats = null;
          dbState.lastStudyStats = null;
          
          if (vueInstance) {
            vueInstance.updateData({
              wordStats: null,
              dueStats: null,
              intervalStats: null,
              reviewStats: null,
              studyStats: null,
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

  const DropdownMenu = {
    props: {
      items: {
        type: Array,
        required: true
      },
      modelValue: {
        type: [String, Number, Object],
        default: null
      },
      itemKey: {
        type: String,
        default: 'id'
      },
      itemLabel: {
        type: [String, Function],
        default: 'name'
      },
      placeholder: {
        type: String,
        default: 'Select an option'
      },
      width: {
        type: Number,
        default: 250
      },
      componentHash: String
    },
    emits: ['update:modelValue'],
    data() {
      return {
        isDropdownOpen: false
      };
    },
    computed: {
      selectedItemLabel() {
        const selectedItem = this.items.find(item => this.getItemKey(item) === this.modelValue);
        return selectedItem ? this.getItemLabel(selectedItem) : this.placeholder;
      }
    },
    methods: {
      toggleDropdown(event) {
        event.stopPropagation();
        this.isDropdownOpen = !this.isDropdownOpen;
      },
      selectItem(item, event) {
        event.stopPropagation();
        const itemKey = this.getItemKey(item);
        if (this.modelValue !== itemKey) {
          this.$emit('update:modelValue', itemKey);
        }
        this.isDropdownOpen = false;
      },
      closeDropdown() {
        this.isDropdownOpen = false;
      },
      getItemKey(item) {
        return item[this.itemKey];
      },
      getItemLabel(item) {
        if (typeof this.itemLabel === 'function') {
          return this.itemLabel(item);
        }
        return item[this.itemLabel];
      }
    },
    mounted() {
      document.addEventListener('click', this.closeDropdown);
    },
    beforeUnmount() {
      document.removeEventListener('click', this.closeDropdown);
    },
    template: `
    <div 
      v-bind:[componentHash]="true" 
      tabindex="0" 
      class="multiselect multiselect--right" 
      :class="{ '-has-value': modelValue !== null, 'multiselect--active': isDropdownOpen }" 
      role="combobox" 
      :style="{ width: width + 'px' }" 
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
        <slot name="trigger" :selectedLabel="selectedItemLabel">
          <span class="multiselect__single">
            <span class="UiTypo UiTypo__caption -no-wrap multiselect__single__text">{{ selectedItemLabel }}</span>
          </span>
        </slot>
      </div>
      <div 
        class="multiselect__content-wrapper" 
        tabindex="-1" 
        style="max-height: 300px;" 
        :style="{ display: isDropdownOpen ? 'block' : 'none' }"
      >
        <ul class="multiselect__content" role="listbox" style="display: inline-block;">
          <li class="multiselect__element" role="option" v-for="item in items" :key="getItemKey(item)">
            <span 
              class="multiselect__option" 
              :class="{ 'multiselect__option--highlight multiselect__option--selected': getItemKey(item) === modelValue }" 
              @click="selectItem(item, $event)"
            >
              <slot name="item" :item="item" :isSelected="getItemKey(item) === modelValue">
                <div class="multiselect__optionWrapper" :style="{ width: width - 40 + 'px' }" >
                  <span 
                    class="UiTypo UiTypo__caption" 
                    :class="{ '-emphasis': getItemKey(item) === modelValue }" 
                    style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                  >
                    {{ getItemLabel(item) }}
                  </span>
                  <div class="UiIcon multiselect__checkIcon" style="width: 24px;">
                    <div v-if="getItemKey(item) === modelValue" class="UiIcon__inner">
                      <div class="UiSvg UiIcon__svg" name="Check" gradient="true" spin="false">
                         <div class="UiSvg__inner UiIcon__gradient" :style="'clip-path: url(#checkmark-dd-' + getItemKey(item) + ');'">
                           <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" role="img">
                            <defs>
                              <clipPath :id="'checkmark-dd-' + getItemKey(item)" data-dont-prefix-id="" transform="scale(1)">
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
              </slot>
            </span>
          </li>
        </ul>
      </div>
    </div>
    `
  };

  const RadioButtonGroup = {
    props: {
      options: {
        type: Array,
        required: true,
      },
      modelValue: {
        type: String,
        required: true,
      },
      componentHash: String,
      name: {
        type: String,
        default: 'radio-group'
      }
    },
    emits: ['update:modelValue'],
    methods: {
      handleChange(event) {
        this.$emit('update:modelValue', event.target.value);
      }
    },
    template: `
    <div v-bind:[componentHash]="true" class="MCS__radio-group" role="radiogroup">
      <div 
        v-for="option in options" 
        :key="option.id" 
        class="UiCheckbox -radio" 
        :class="{ '-toggled': modelValue === option.id }"
        v-bind:[componentHash]="true"
      >
        <div class="UiCheckbox__input">
          <input 
            type="radio" 
            :name="name" 
            :id="name + '-' + option.id" 
            :value="option.id" 
            :checked="modelValue === option.id" 
            @change="handleChange" 
            class="UiCheckbox__input__element"
            v-bind:[componentHash]="true"
          >
          <div class="UiCheckbox__icon__container">
            <div
              class="UiCheckbox__icon MCS__radio-button"
              :class="{ '-toggled': modelValue === option.id }"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none" />
              </svg>
            </div>
          </div>
        </div>
        <label :for="name + '-' + option.id" class="UiCheckbox__label UiTypo UiTypo__caption">
          {{ option.name }}
        </label>
      </div>
    </div>
    `
  };

  const DeckSelector = {
    components: { DropdownMenu },
    props: {
      availableDecks: Array,
      selectedDeckId: String,
      componentHash: String
    },
    emits: ['deck-selected'],
    methods: {
      handleDeckUpdate(newDeckId) {
        if (this.selectedDeckId !== newDeckId) {
          this.$emit('deck-selected', newDeckId);
        }
      }
    },
    template: `
    <div v-bind:[componentHash]="true" class="MCS__deck-selector UiFormField SettingsGeneral__optionLeft">
      <div class="UiFormField__labelContainer">
        <label v-bind:[componentHash]="true" class="UiTypo UiTypo__body UiFormField__labelContainer__typo">Deck</label>
      </div>
      <div class="UiFormField__controlContainer">
        <dropdown-menu
          :items="availableDecks"
          :modelValue="selectedDeckId"
          @update:modelValue="handleDeckUpdate"
          item-key="id"
          item-label="name"
          placeholder="Select Deck"
          :width="250"
          :component-hash="componentHash"
        >
          <template #trigger="{ selectedLabel }">
            <span class="multiselect__single">
              <span class="UiTypo UiTypo__caption -no-wrap multiselect__single__text">{{ selectedLabel }}</span>
            </span>
          </template>
        </dropdown-menu>
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
      chartRef: String,
      selectedPeriod: {
        type: String,
        default: "dueStats1"
      }
    },
    components: {
      DropdownMenu
    },
    data() {
      return {
        periodOptions: [
          { id: "dueStats1", name: '1 Month' },
          { id: "dueStats2", name: '2 Months' },
          { id: "dueStats3", name: '3 Months' },
          { id: "dueStats6", name: '6 Months' },
          { id: "dueStats12", name: '12 Months' },
          { id: "dueStatsAll", name: 'All time' }
        ]
      };
    },
    computed: {
      currentPeriod: {
        get() {
          return this.selectedPeriod;
        },
        set(value) {
          this.$emit('period-change', value);
        }
      },
      forecastDays() {
        const selectedOption = this.periodOptions.find(p => p.id === this.currentPeriod);
        return selectedOption ? selectedOption.days : 30;
      }
    },
    methods: {
      handlePeriodChange(period) {
        this.currentPeriod = period;
      }
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
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Cards Due</h3>
          <div class="MCS__header-selector">
            <dropdown-menu
              :items="periodOptions"
              :modelValue="currentPeriod"
              @update:modelValue="handlePeriodChange"
              item-key="id"
              item-label="name"
              placeholder="Select Period"
              :width="180"
              :component-hash="componentHash"
            >
              <template #trigger="{ selectedLabel }">
                <span class="multiselect__single">
                  <span
                    v-if="selectedLabel !== 'All time'"
                    class="UiTypo UiTypo__caption -no-wrap multiselect__single__text"
                  >
                    Next {{ selectedLabel }}
                  </span>
                  <span
                    v-else
                    class="UiTypo UiTypo__caption -no-wrap multiselect__single__text"
                  >
                    All time
                  </span>
                </span>
              </template>
            </dropdown-menu>
          </div>
        </div>
        <div v-bind:[componentHash]="true" class="MCS__duechart">
          <canvas ref="canvas"></canvas>
        </div>
      </div>
      <div v-else v-bind:[componentHash]="true" class="MCS__due-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Cards Due</h3>
           <div class="MCS__header-selector">
            <dropdown-menu
              :items="periodOptions"
              :modelValue="currentPeriod"
              @update:modelValue="handlePeriodChange"
              item-key="id"
              item-label="name"
              placeholder="Select Period"
              :width="180"
              :component-hash="componentHash"
            >
              <template #trigger="{ selectedLabel }">
                <span class="multiselect__single">
                  <span class="UiTypo UiTypo__caption -no-wrap multiselect__single__text">Next {{ selectedLabel }}</span>
                </span>
              </template>
            </dropdown-menu>
          </div>
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
    components: {
      DropdownMenu
    },
    data() {
      return {
        selectedPercentile: "intervalPercentile75",
        percentileOptions: [
          { id: "intervalPercentile50", name: '50th' },
          { id: "intervalPercentile75", name: '75th' },
          { id: "intervalPercentile95", name: '95th' },
          { id: "intervalPercentile100", name: '100th' }
        ]
      };
    },
    methods: {
      handlePercentileChange(value) {
        this.selectedPercentile = value;
        this.$emit('percentile-changed', value);
      }
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
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Review Intervals</h3>
          <div class="MCS__header-selector">
            <dropdown-menu
              :items="percentileOptions"
              :modelValue="selectedPercentile"
              @update:modelValue="handlePercentileChange"
              item-key="id"
              item-label="name"
              placeholder="Select Percentile"
              :width="180"
              :component-hash="componentHash"
            >
              <template #trigger="{ selectedLabel }">
                <span class="multiselect__single">
                  <span class="UiTypo UiTypo__caption -no-wrap multiselect__single__text">{{ selectedLabel }} Percentile</span>
                </span>
              </template>
            </dropdown-menu>
          </div>
        </div>
        <div v-bind:[componentHash]="true" class="MCS__intervalchart">
          <canvas ref="canvas"></canvas>
        </div>
      </div>
      <div v-else v-bind:[componentHash]="true" class="MCS__interval-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Review Intervals</h3>
          <div class="MCS__header-selector">
            <dropdown-menu
              :items="percentileOptions"
              :modelValue="selectedPercentile"
              @update:modelValue="handlePercentileChange"
              item-key="id"
              item-label="name"
              placeholder="Select Percentile"
              :width="120"
              :component-hash="componentHash"
            >
              <template #trigger="{ selectedLabel }">
                <span class="multiselect__single">
                  <span class="UiTypo UiTypo__caption -no-wrap multiselect__single__text">{{ selectedLabel }} Percentile</span>
                </span>
              </template>
            </dropdown-menu>
          </div>
        </div>
        <p v-bind:[componentHash]="true" class="UiTypo UiTypo__body2">Could not load review interval data.</p>
      </div>
    `
  };
  
  const StudyStatsCard = {
    components: {
      DropdownMenu
    },
    props: {
      studyStats: Object,
      componentHash: String
    },
    data() {
      return {
        selectedPeriod: "studyStats1",
        periodOptions: [
          { id: "studyStats1", name: '1 Month' },
          { id: "studyStats2", name: '2 Months' },
          { id: "studyStats3", name: '3 Months' },
          { id: "studyStats6", name: '6 Months' },
          { id: "studyStats12", name: '12 Months' },
          { id: "studyStatsAll", name: 'All time' }
        ]
      };
    },
    methods: {
      handlePeriodChange(period) {
        this.selectedPeriod = period;
        this.$emit('period-change', period);
      }
    },
    template: `
      <div v-if="studyStats" v-bind:[componentHash]="true" class="MCS__study-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Study Statistics</h3>
          <div class="MCS__header-selector">
            <dropdown-menu
              :items="periodOptions"
              :modelValue="selectedPeriod"
              @update:modelValue="handlePeriodChange"
              item-key="id"
              item-label="name"
              placeholder="Select Period"
              :width="180"
              :component-hash="componentHash"
            >
              <template #trigger="{ selectedLabel }">
                <span class="multiselect__single">
                  <span
                    v-if="selectedLabel !== 'All time'"
                    class="UiTypo UiTypo__caption -no-wrap multiselect__single__text"
                  >
                    Last {{ selectedLabel }}
                  </span>
                  <span
                    v-else
                    class="UiTypo UiTypo__caption -no-wrap multiselect__single__text"
                  >
                    All time
                  </span>
                </span>
              </template>
            </dropdown-menu>
          </div>
        </div>
        <div v-bind:[componentHash]="true" class="MCS__study-stats">
          <div v-bind:[componentHash]="true" class="MCS__stat-box">
            <div v-bind:[componentHash]="true" class="MCS__stat-value">{{ studyStats.days_studied_percent }}%</div>
            <div v-bind:[componentHash]="true" class="MCS__stat-label">of days studied</div>
          </div>
          <div v-bind:[componentHash]="true" class="MCS__stat-box">
            <div v-bind:[componentHash]="true" class="MCS__stat-value">{{ studyStats.pass_rate }}%</div>
            <div v-bind:[componentHash]="true" class="MCS__stat-label">Pass rate</div>
          </div>
          <div v-bind:[componentHash]="true" class="MCS__stat-box">
            <div v-bind:[componentHash]="true" class="MCS__stat-value">{{ studyStats.total_reviews.toLocaleString() }}</div>
            <div v-bind:[componentHash]="true" class="MCS__stat-label">Total reviews</div>
          </div>
          <div v-bind:[componentHash]="true" class="MCS__stat-box">
            <div v-bind:[componentHash]="true" class="MCS__stat-value">{{ studyStats.avg_reviews_per_day }}</div>
            <div v-bind:[componentHash]="true" class="MCS__stat-label">Avg. reviews per study day</div>
          </div>
        </div>
      </div>
      <div v-else v-bind:[componentHash]="true" class="MCS__study-stats-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Study Statistics</h3>
        </div>
        <p v-bind:[componentHash]="true" class="UiTypo UiTypo__body2">Could not load study statistics data.</p>
      </div>
    `
  };
  
  const ReviewHistoryCard = {
    components: {
      DropdownMenu,
      RadioButtonGroup
    },
    props: {
      reviewStats: Object,
      componentHash: String,
      chartRef: String,
      selectedPeriod: {
        type: String,
        default: "reviewHistory1"
      },
      selectedGrouping: {
        type: String,
        default: "Days"
      }
    },
    data() {
      return {
        periodOptions: [
          { id: "reviewHistory1", name: '1 Month' },
          { id: "reviewHistory2", name: '2 Months' },
          { id: "reviewHistory3", name: '3 Months' },
          { id: "reviewHistory6", name: '6 Months' },
          { id: "reviewHistory12", name: '12 Months' },
          { id: "reviewHistoryAll", name: 'All time' }
        ],
        groupingOptions: [
          { id: "Days", name: 'Days' },
          { id: "Weeks", name: 'Weeks' },
          { id: "Months", name: 'Months' }
        ]
      };
    },
    computed: {
      currentPeriod: {
        get() {
          return this.selectedPeriod;
        },
        set(value) {
          this.$emit('period-change', value);
        }
      },
      currentGrouping: {
        get() {
          return this.selectedGrouping;
        },
        set(value) {
          this.$emit('grouping-change', value);
        }
      }
    },
    methods: {
      handlePeriodChange(period) {
        this.currentPeriod = period;
      },
      handleGroupingChange(grouping) {
        this.currentGrouping = grouping;
      }
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
      <div v-if="reviewStats && reviewStats.labels && reviewStats.counts" v-bind:[componentHash]="true" class="MCS__review-history-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Review History</h3>
          <div class="MCS__header-selector">
            <dropdown-menu
              :items="periodOptions"
              :modelValue="currentPeriod"
              @update:modelValue="handlePeriodChange"
              item-key="id"
              item-label="name"
              placeholder="Select Period"
              :width="180"
              :component-hash="componentHash"
            >
              <template #trigger="{ selectedLabel }">
                <span class="multiselect__single">
                  <span
                    v-if="selectedLabel !== 'All time'"
                    class="UiTypo UiTypo__caption -no-wrap multiselect__single__text"
                  >
                    Last {{ selectedLabel }}
                  </span>
                  <span
                    v-else
                    class="UiTypo UiTypo__caption -no-wrap multiselect__single__text"
                  >
                    All time
                  </span>
                </span>
              </template>
            </dropdown-menu>
          </div>
        </div>
        <radio-button-group
          style="margin-right: 8px;"
          :options="groupingOptions"
          :modelValue="currentGrouping"
          @update:modelValue="handleGroupingChange"
          name="review-grouping"
          :component-hash="componentHash"
        />
        <div v-bind:[componentHash]="true" class="MCS__reviewchart">
          <canvas ref="canvas"></canvas>
        </div>
      </div>
      <div v-else v-bind:[componentHash]="true" class="MCS__review-history-card">
        <div v-bind:[componentHash]="true" class="Statistic__card__header">
          <h3 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading3 -heading">Review History</h3>
          <div class="MCS__header-selector">
            <radio-button-group
              style="margin-right: 8px;"
              :options="groupingOptions"
              :modelValue="currentGrouping"
              @update:modelValue="handleGroupingChange"
              name="review-grouping-fallback"
              :component-hash="componentHash"
            />
            <dropdown-menu
              :items="periodOptions"
              :modelValue="currentPeriod"
              @update:modelValue="handlePeriodChange"
              item-key="id"
              item-label="name"
              placeholder="Select Period"
              :width="180"
              :component-hash="componentHash"
            >
              <template #trigger="{ selectedLabel }">
                <span class="multiselect__single">
                  <span class="UiTypo UiTypo__caption -no-wrap multiselect__single__text">Last {{ selectedLabel }}</span>
                </span>
              </template>
            </dropdown-menu>
          </div>
        </div>
        <p v-bind:[componentHash]="true" class="UiTypo UiTypo__body2">Could not load review history data.</p>
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

    if (statsContainer) {
      statsContainer.style.maxWidth = "calc(100% - 32px)";
      statsContainer.parentElement.style.maxWidth = "100vw";
      statsContainer.classList.add("MCS__stats-container");
    }

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
        dbState.lastReviewStats = null;
        dbState.lastStudyStats = null;
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
      dbState.lastReviewStats = null;
      dbState.lastStudyStats = null;
    }

    const vueContainer = document.createElement('div');
    vueContainer.id = SELECTORS.VUE_CONTAINER_ID;
    statsContainer.appendChild(vueContainer);

    const app = Vue.createApp({
      components: {
        DropdownMenu,
        DeckSelector,
        WordStatsCard,
        DueStatsCard,
        MessageCard,
        IntervalStatsCard,
        ReviewHistoryCard,
        StudyStatsCard,
        RadioButtonGroup
      },
      data() {
        return {
          wordStats,
          dueStats,
          intervalStats,
          reviewStats: data && data.reviewStats || null,
          studyStats: data && data.studyStats || null,
          isError,
          message,
          availableDecks: dbState.availableDecks,
          selectedDeckId: appState.selectedDeckId,
          selectedLanguage: appState.selectedLanguage,
          selectedPercentile: "intervalPercentile75",
          selectedPeriodStudyStats: "studyStats1",
          selectedPeriodReviewHistory: "reviewHistory1",
          selectedDuePeriod: "dueStats1",
          selectedReviewGrouping: "Days",
          componentHash,
          currentTheme: getCurrentTheme(),
          wordChartRendered: false,
          dueChartRendered: false,
          intervalChartRendered: false,
          reviewChartRendered: false,
          wordCanvas: null,
          dueCanvas: null,
          intervalCanvas: null,
          reviewCanvas: null
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
        handleReviewCanvasMounted(canvas) {
          this.reviewCanvas = canvas;
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
        handleReviewCanvasUnmounted() {
          extensionLog("Review canvas unmounted, cleaning up");
          this.reviewCanvas = null;
          this.reviewChartRendered = false;
        },
        updateCharts() {
          this.debouncedUpdateCharts();
        },
        renderCharts() {
          this.renderWordChart();
          this.renderDueChart();
          this.renderIntervalChart();
          this.renderReviewChart();
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
        renderReviewChart() {
          if (this.reviewChartRendered || !this.reviewCanvas || !this.reviewStats) {
            return;
          }
          
          this.reviewChartRendered = true;
          
          ChartManager.createReviewHistoryChart(
            this.reviewCanvas,
            this.reviewStats,
            extensionLog
          );
        },
        debouncedUpdateCharts: debounce(function() {
          extensionLog("Debounced chart update triggered");
          
          this.wordChartRendered = false;
          this.dueChartRendered = false;
          this.intervalChartRendered = false;
          this.reviewChartRendered = false;
          
          this.$nextTick(() => {
            ChartManager.updateCharts({
              wordCanvas: this.wordCanvas,
              dueCanvas: this.dueCanvas,
              intervalCanvas: this.intervalCanvas,
              reviewCanvas: this.reviewCanvas,
              wordStats: this.wordStats,
              dueStats: this.dueStats,
              intervalStats: this.intervalStats,
              reviewStats: this.reviewStats,
              logFn: extensionLog,
              onComplete: (results) => {
                this.wordChartRendered = results.wordChartSuccess;
                this.dueChartRendered = results.dueChartSuccess;
                this.intervalChartRendered = results.intervalChartSuccess;
                this.reviewChartRendered = results.reviewChartSuccess;
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
          if (newData.reviewStats !== undefined) {
            this.reviewStats = newData.reviewStats;
          }
          if (newData.studyStats !== undefined) {
            this.studyStats = newData.studyStats;
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
        },
        handleIntervalPercentileChanged(percentile) {
          if (this.selectedPercentile === percentile) {
            return;
          }
          
          this.selectedPercentile = percentile;
          runFilteredStatsQuery(this);
        },
        handleStudyStatsPeriodChange(period) {
          if (this.selectedPeriodStudyStats === period) {
            return;
          }
          
          this.selectedPeriodStudyStats = period;
          runFilteredStatsQuery(this);
        },
        handleReviewHistoryPeriodChange(period) {
          if (this.selectedPeriodReviewHistory === period) {
            return;
          }
          
          this.selectedPeriodReviewHistory = period;
          runFilteredStatsQuery(this);
        },
        handleReviewHistoryGroupingChange(grouping) {
          if (this.selectedReviewGrouping === grouping) {
             return;
          }
          this.selectedReviewGrouping = grouping;
          runFilteredStatsQuery(this);
        },
        handleDuePeriodChange(period) {
          if (this.selectedDuePeriod === period) {
            return;
          }
          
          this.selectedDuePeriod = period;
          runFilteredStatsQuery(this);
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
        reviewStats: {
          handler() {
            extensionLog("reviewStats changed, scheduling chart update");
            this.reviewChartRendered = false;
            this.$nextTick(this.debouncedUpdateCharts);
          },
          deep: true
        },
        currentTheme() {
          extensionLog("Theme changed, scheduling chart update");
          this.wordChartRendered = false;
          this.dueChartRendered = false;
          this.intervalChartRendered = false;
          this.reviewChartRendered = false;
          this.$nextTick(this.debouncedUpdateCharts);
        },
        selectedLanguage(newLang, oldLang) {
          if (newLang !== oldLang) {
            extensionLog(`Language changed in component from ${oldLang} to ${newLang}, resetting charts`);
            ChartManager.resetCharts();
            this.wordCanvas = null;
            this.dueCanvas = null;
            this.intervalCanvas = null;
            this.reviewCanvas = null;
            this.wordChartRendered = false;
            this.dueChartRendered = false;
            this.intervalChartRendered = false;
            this.reviewChartRendered = false;
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
        this.reviewCanvas = null;
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
            <h2 v-bind:[componentHash]="true" class="UiTypo UiTypo__heading2 -heading Statistic__title CustomStats__title">Migaku Custom Stats</h2>
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
                :selected-period="selectedDuePeriod"
                @period-change="handleDuePeriodChange"
              />
              
              <!-- Interval Stats -->
              <interval-stats-card 
                :interval-stats="intervalStats" 
                :component-hash="componentHash" 
                chart-ref="intervalChart"
                @canvas-mounted="handleIntervalCanvasMounted"
                @canvas-unmounted="handleIntervalCanvasUnmounted"
                @percentile-changed="handleIntervalPercentileChanged"
              />
              
              <!-- Study Stats -->
              <study-stats-card 
                :study-stats="studyStats" 
                :component-hash="componentHash"
                @period-change="handleStudyStatsPeriodChange"
              />
              
              <!-- Review History -->
              <review-history-card 
                :review-stats="reviewStats"
                :selectedPeriod="selectedPeriodReviewHistory"
                :selectedGrouping="selectedReviewGrouping"
                :component-hash="componentHash"
                chart-ref="reviewChart"
                @canvas-mounted="handleReviewCanvasMounted"
                @canvas-unmounted="handleReviewCanvasUnmounted"
                @period-change="handleReviewHistoryPeriodChange"
                @grouping-change="handleReviewHistoryGroupingChange"
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
            reviewStats: null,
            studyStats: null,
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
