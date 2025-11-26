// ==UserScript==
// @name         Migaku Kanji Stats
// @namespace    http://tampermonkey.net/
// @version      1.1.2
// @updateURL    https://github.com/Knoodel/Migaku-Kanji-Stats/raw/refs/heads/master/migakuKanjiStats.user.js
// @downloadURL  https://github.com/Knoodel/Migaku-Kanji-Stats/raw/refs/heads/master/migakuKanjiStats.user.js
// @description  Kanji God's Statistics Page ported to Migaku Memory
// @author       Noodle
// @license      GPL-3.0
// @match        https://study.migaku.com/*
// @run-at       document-idle
// @require      https://cdnjs.cloudflare.com/ajax/libs/pako/2.1.0/pako.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/sql-wasm.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/vue/3.4.21/vue.global.min.js
// @grant        GM_addStyle
// @grant        GM.xmlHttpRequest
// @connect      github.com
// @connect      raw.githubusercontent.com
// ==/UserScript==

/* global pako, initSqlJs, Vue */

(function () {
  // Constants
  const SETTINGS = {
    DEFAULT_TIMEOUT: 15000,
    DEBUG: false,
  };

  const KANJI_DB_URL =
    "https://github.com/migaku-official/Migaku-Kanji-Addon/blob/main/addon/kanji.db?raw=true";

  const DB_CONFIG = {
    DB_NAME: "srs",
    OBJECT_STORE: "data",
    SQL_CDN_PATH: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/",
  };

  const WORD_STATUS = {
    KNOWN: "KNOWN",
    LEARNING: "LEARNING",
    UNKNOWN: "UNKNOWN",
    IGNORED: "IGNORED",
  };

  const SQL_QUERIES = {
    WORDS_BY_STATUS: `
        SELECT dictForm
        FROM WordList
        WHERE language = ? AND del = 0
        AND knownStatus = ?;
    `,
  };

  const SELECTORS = {
    UI_PAGE_LAYOUT: ".UiPageLayout",
    STATISTIC: ".Statistic",
    MOUNT_ID: "migaku-kanji-stats-vue-container",
    MIGAKU_SRS: ".MIGAKU-SRS",
  };

  const ATTRIBUTES = {
    LANGUAGE: "data-mgk-lang-selected",
  };

  const FILTER_OPTIONS = [
    {
      id: 0,
      label: "All Kanji",
      column: null,
      filter: null,
      order: null,
      levelLabel: (level) => null,
    },
    {
      id: 1,
      label: "JLPT",
      column: "jlpt",
      filter: null,
      order: "DESC",
      levelLabel: (level) => `N${level}`,
    },
    {
      id: 2,
      label: "Kanken",
      column: "kanken",
      filter: null,
      order: "DESC",
      levelLabel: (level) => `Level ${level}`,
    },
    {
      id: 3,
      label: "Jōyō",
      column: "frequency_rank",
      filter: "grade <= 8",
      order: "ASC",
      levelLabel: (level) => null,
    },
  ];

  // Application state
  const APP_STATE = {
    MIGAKU_INDEXED_DB: null,
    KANJI_DB: null,
    previousRoute: null,
    VUE_APP: null,
    LANGUAGE_OBSERVER: null,
    MOUNT_ELEMENT: null,
  };

  // Cache
  let MIGAKU_SQL_DB = null;
  let SQL_ENGINE = null;
  const FILTER_CACHE = new Map();

  const KANJI_REGEX = /\p{Unified_Ideograph}/u;

  // loging
  const log = (...args) => SETTINGS.DEBUG && console.log("[MKS]", ...args);
  const logInfo = (...args) => log(...args);
  const logWarn = (...args) => log("WARN:", ...args);
  const logError = (...args) => log("ERROR:", ...args);

  function cleanupResources({
    closeKanjiDb = false,
    closeIndexedDb = false,
  } = {}) {
    try {
      if (MIGAKU_SQL_DB) {
        try {
          MIGAKU_SQL_DB.close();
        } catch (e) {
          logError("Error closing MIGAKU_SQL_DB:", e);
        }
        MIGAKU_SQL_DB = null;
      }

      if (closeIndexedDb && APP_STATE.MIGAKU_INDEXED_DB) {
        try {
          APP_STATE.MIGAKU_INDEXED_DB.close();
          logInfo(
            "Closed APP_STATE.MIGAKU_INDEXED_DB as part of cleanupResources."
          );
        } catch (e) {
          logError("Error closing APP_STATE.MIGAKU_INDEXED_DB:", e);
        }
        APP_STATE.MIGAKU_INDEXED_DB = null;
      }

      if (closeKanjiDb && APP_STATE.KANJI_DB) {
        try {
          APP_STATE.KANJI_DB.close();
        } catch (e) {
          logError("Error closing APP_STATE.KANJI_DB:", e);
        }
        APP_STATE.KANJI_DB = null;
      }

      MIGAKU_DB_BUFFER = null;

      try {
        FILTER_CACHE.clear();
      } catch (e) {
        logError("Failed to clear FILTER_CACHE:", e);
      }

      logInfo(
        "cleanupResources: cleared cached Migaku DB buffer, SQL instance and FILTER_CACHE."
      );
    } catch (err) {
      logError("cleanupResources error:", err);
    }
  }

  // Styles
  GM_addStyle(`
    .UiPageLayout {
      max-width: 1080px !important;
    }

    #migaku-kanji-stats-vue-container {
        grid-column: 1 / span 2;
    }

    #MKS-container {
        margin: 32px 0;
    }

    .kanji-grid-wrapper {
      height: calc(100% - 160px);
      overflow-y: auto;
    }

    .kanji-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
      gap: 10px;
      padding: 10px;
      overflow-y: auto;
      box-sizing: border-box;
      width: 100%;
      max-height: calc(100% - 88px);
    }

    .UiCard.-lesson.Statistic__card.kanji-stats {
        height: 80vh;
        max-width: 100% !important;
    }

    .kanji {
        display: flex;
        justify-content: center;
        align-items: center;
        padding: 10px;
        font-size: 1.5rem;
        border-radius: 5px;
        text-align: center;
        user-select: text;
    }

    .known-kanji {
        background-color: #00c7a4;
    }

    .learning-kanji {
        background-color: #ff9345;
    }

    .unknown-kanji {
        background-color: #fe4670;
    }

    .header-relative {
        position: relative;
    }

    .header-relative .UiButton {
        position: absolute;
        right: 0;
    }
    `);

  // Components
  const GroupedKanjiGrid = {
    props: {
      filterId: Number,
      filteredKanji: Array,
      knownKanji: Array,
      learningKanji: Array,
      knownKanjiSet: Object,
      learningKanjiSet: Object,
      componentHash: String,
    },
    data() {
      return {
        label: "",
      };
    },
    computed: {
      componentAttrs() {
        return { [this.componentHash]: true };
      },
      groupedKanji() {
        const map = new Map();
        const filter = FILTER_OPTIONS[this.filterId];
        this.label = filter.label;

        const knownSet = this.knownKanjiSet || new Set(this.knownKanji || []);
        const learningSet =
          this.learningKanjiSet || new Set(this.learningKanji || []);

        for (const [kanji, level] of this.filteredKanji) {
          const lvl = filter.levelLabel(level) ?? 0;
          const status = knownSet.has(kanji)
            ? "known"
            : learningSet.has(kanji)
            ? "learning"
            : "unknown";

          if (!map.has(lvl))
            map.set(lvl, { label: lvl, kanji: [], knownCount: 0 });
          const group = map.get(lvl);
          group.kanji.push({ character: kanji, status });
          if (status === "known") group.knownCount += 1;
        }

        const groups = Array.from(map.values());
        groups.forEach((group) => {
          const total = group.kanji.length;
          const known = group.knownCount;
          group.displayText = `${known}/${total} - ${(
            (known / total) *
            100
          ).toFixed(2)}%`;
        });

        return groups;
      },
      overallStats() {
        const allKanji = this.filteredKanji.map(([kanji]) => kanji);
        const total = allKanji.length;
        const knownSet = this.knownKanjiSet || new Set(this.knownKanji || []);
        const known = allKanji.filter((k) => knownSet.has(k)).length;
        const percentage =
          total > 0 ? ((known / total) * 100).toFixed(2) : "0.00";
        return `${known}/${total} - ${percentage}%`;
      },
      showGroupStats() {
        return this.groupedKanji.length > 1;
      },
    },
    template: `
    <div v-bind="componentAttrs" class="kanji-grid-wrapper">
      <div class="Statistic__card__header" v-bind="componentAttrs">
        <div v-bind="componentAttrs">
        <h3 class="UiTypo UiTypo__heading3 -heading" v-bind="componentAttrs">{{ label }}</h3>
        <p class="UiTypo UiTypo__caption" v-bind="componentAttrs">{{ overallStats }}</p>
        </div>
      </div>
      <template v-for="kanjiGroup in groupedKanji" :key="kanjiGroup.label">
      <div class="Statistic__card__header" v-bind="componentAttrs">
        <div v-bind="componentAttrs">
        <h4 v-if="showGroupStats && kanjiGroup.label" class="UiTypo UiTypo__heading4 -heading" v-bind="componentAttrs">{{ kanjiGroup.label }}</h4>
        <p class="UiTypo UiTypo__caption" v-if="showGroupStats && kanjiGroup.kanji.length > 0" v-bind="componentAttrs">{{ kanjiGroup.displayText }}</p>
        </div>
      </div>
        <div class="kanji-grid">
          <div v-for="kanjiElement in kanjiGroup.kanji"
               :key="kanjiElement.character"
               :class="['kanji', kanjiElement.status + '-kanji']">
            {{ kanjiElement.character }}
          </div>
        </div>
      </template>
    </div>
  `,
  };

  const DropdownMenu = {
    props: {
      items: {
        type: Array,
        required: true,
      },
      modelValue: {
        type: [String, Number, Object],
        default: null,
      },
      itemKey: {
        type: String,
        default: "id",
      },
      itemLabel: {
        type: [String, Function],
        default: "label",
      },
      placeholder: {
        type: String,
        default: "Select an option",
      },
      width: {
        type: Number,
        default: 250,
      },
      componentHash: String,
    },
    emits: ["update:modelValue"],
    data() {
      return {
        isDropdownOpen: false,
      };
    },
    computed: {
      selectedItemLabel() {
        const selectedItem = this.items.find(
          (item) => this.getItemKey(item) === this.modelValue
        );
        return selectedItem
          ? this.getItemLabel(selectedItem)
          : this.placeholder;
      },
      componentAttrs() {
        return { [this.componentHash]: true };
      },
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
          this.$emit("update:modelValue", itemKey);
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
        if (typeof this.itemLabel === "function") {
          return this.itemLabel(item);
        }
        return item[this.itemLabel];
      },
    },
    mounted() {
      document.addEventListener("click", this.closeDropdown);
    },
    beforeUnmount() {
      document.removeEventListener("click", this.closeDropdown);
    },
    template: `
    <div
      v-bind="componentAttrs"
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
    `,
  };

  const FilterSelector = {
    components: { DropdownMenu },
    props: {
      filters: Array,
      selectedFilterId: Number,
      componentHash: String,
    },
    emits: ["filter-selected"],
    computed: {
      componentAttrs() {
        return { [this.componentHash]: true };
      },
    },
    template: `
    <div v-bind="componentAttrs" class="MKS-filter-selector UiFormField SettingsGeneral__optionLeft">
      <div class="UiFormField__labelContainer">
        <h4 v-bind="componentAttrs" class="UiTypo UiTypo__heading4 -heading">Filter</h4>
      </div>
      <div class="UiFormField__controlContainer">
        <dropdown-menu
          :items="filters"
          :modelValue="selectedFilterId"
          @update:modelValue="handleFilterUpdate"
          item-key="id"
          item-label="label"
          placeholder="Select Filter"
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
    `,
    methods: {
      handleFilterUpdate(newFilterId) {
        if (this.selectedFilterId !== newFilterId) {
          this.$emit("filter-selected", newFilterId);
        }
      },
    },
  };

  // Utility functions
  function waitForElement(selector, timeout = SETTINGS.DEFAULT_TIMEOUT) {
    return new Promise((resolve) => {
      const element = document.querySelector(selector);
      if (element) return resolve(element);

      const observer = new MutationObserver((_, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  async function initKanjiDB() {
    return new Promise((resolve, reject) => {
      if (APP_STATE.KANJI_DB) {
        logInfo("Kanji DB already loaded.");
        return resolve(APP_STATE.KANJI_DB);
      }

      logInfo("Fetching kanji.db...");
      GM.xmlHttpRequest({
        method: "GET",
        url: KANJI_DB_URL,
        responseType: "arraybuffer",
        onload: async (res) => {
          try {
            if (!res || !res.response) {
              logError("initKanjiDB: empty response from GM.xmlHttpRequest");
              return reject(new Error("Empty response when fetching kanji.db"));
            }
            const arrayBuffer = res.response;
            const SQL = await initializeSqlEngine();
            if (!SQL) {
              logError("initKanjiDB: sql.js engine failed to initialize");
              return reject(new Error("sql.js engine initialization failed"));
            }
            const db = new SQL.Database(new Uint8Array(arrayBuffer));
            logInfo("kanji.db successfully loaded into SQL.js");
            APP_STATE.KANJI_DB = db;
            resolve(APP_STATE.KANJI_DB);
          } catch (err) {
            logError("Failed to open kanji.db:", err);
            reject(err);
          }
        },
        onerror: (err) => {
          logError("Failed to fetch kanji.db", err);
          reject(err);
        },
      });
    });
  }

  function decompressData(compressedData) {
    try {
      logInfo("Attempting Gzip decompression...");
      const decompressedData = pako.inflate(compressedData);
      logInfo("Decompression successful.");
      return decompressedData;
    } catch (err) {
      logError("Gzip Decompression failed:", err);
      return null;
    }
  }

  async function initializeSqlEngine() {
    if (SQL_ENGINE) {
      logInfo("Using cached sql.js engine.");
      return SQL_ENGINE;
    }
    try {
      logInfo("Initializing sql.js...");
      SQL_ENGINE = await initSqlJs({
        locateFile: (file) => `${DB_CONFIG.SQL_CDN_PATH}${file}`,
      });
      logInfo("sql.js initialized successfully.");
      return SQL_ENGINE;
    } catch (err) {
      logError("Failed to initialize sql.js:", err);
      return null;
    }
  }

  function openIndexedDB() {
    return new Promise((resolve, reject) => {
      if (APP_STATE.MIGAKU_INDEXED_DB) {
        logInfo("Using existing DB connection.");
        resolve(APP_STATE.MIGAKU_INDEXED_DB);
        return;
      }

      logInfo("Attempting to open IndexedDB...");
      const request = indexedDB.open(DB_CONFIG.DB_NAME);

      request.onerror = (event) => {
        logError(`IndexedDB error: ${event.target.errorCode}`);
        reject(new Error(`IndexedDB error: ${event.target.errorCode}`));
      };

      request.onsuccess = (event) => {
        logInfo("Successfully connected to Migaku DB:", DB_CONFIG.DB_NAME);
        APP_STATE.MIGAKU_INDEXED_DB = event.target.result;

        try {
          APP_STATE.MIGAKU_INDEXED_DB.onversionchange = () => {
            logInfo(
              "Migaku IndexedDB version change detected — clearing cache."
            );
            try {
              cleanupResources();
            } catch (e) {
              logError("Error during cleanupResources on version change:", e);
            }
          };
        } catch (e) {
          logWarn("onversionchange not supported or failed to attach:", e);
        }
        resolve(APP_STATE.MIGAKU_INDEXED_DB);
      };

      request.onupgradeneeded = () => {
        logInfo("Database upgrade needed. Skipping.");
      };
    });
  }

  async function getWordsByStatus(status, language = "ja") {
    if (MIGAKU_SQL_DB) {
      try {
        const results = MIGAKU_SQL_DB.exec(SQL_QUERIES.WORDS_BY_STATUS, [
          language,
          status,
        ]);
        const words = results.length > 0 ? results[0].values.flat() : [];
        return words;
      } catch (err) {
        logError("Failed to run SQL query on cached Migaku DB:", err);
        return [];
      }
    }

    let db;
    try {
      db = await openIndexedDB();
    } catch (err) {
      logError("openIndexedDB failed in getWordsByStatus:", err);
      return [];
    }

    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(
          [DB_CONFIG.OBJECT_STORE],
          "readonly"
        );
        const objectStore = transaction.objectStore(DB_CONFIG.OBJECT_STORE);
        const getAllRequest = objectStore.getAll();

        transaction.onerror = (event) => {
          logError("IndexedDB transaction error in getWordsByStatus:", event);
          resolve([]);
        };

        getAllRequest.onerror = (event) => {
          logError("Error reading from IndexedDB:", event.target.error);
          resolve([]);
        };

        getAllRequest.onsuccess = async (event) => {
          try {
            const allRecords = event.target.result;

            if (
              !allRecords.length ||
              !(allRecords[0].data instanceof Uint8Array)
            ) {
              logError("Unexpected or missing data in IndexedDB.");
              resolve([]);
              return;
            }

            const decompressed = decompressData(allRecords[0].data);
            if (!decompressed) {
              logError("Failed to decompress database blob.");
              resolve([]);
              return;
            }

            const SQL = await initializeSqlEngine();
            if (!SQL) {
              logError("SQL.js initialization failed.");
              resolve([]);
              return;
            }

            if (MIGAKU_SQL_DB) {
              try {
                MIGAKU_SQL_DB.close();
              } catch (e) {
                logError("Error closing existing Migaku SQL DB:", e);
              }
            }
            MIGAKU_DB_BUFFER = decompressed;
            MIGAKU_SQL_DB = new SQL.Database(decompressed);
            logInfo("Cached new Migaku DB buffer and SQL instance.");

            const results = MIGAKU_SQL_DB.exec(SQL_QUERIES.WORDS_BY_STATUS, [
              language,
              status,
            ]);
            const words = results.length > 0 ? results[0].values.flat() : [];
            resolve(words);
          } catch (err) {
            logError(
              "Failed to run SQL query in getWordsByStatus onsuccess:",
              err
            );
            resolve([]);
          }
        };
      } catch (err) {
        logError("Unexpected error in getWordsByStatus:", err);
        resolve([]);
      }
    });
  }

  // Kanji processing
  function calculateKanjiStats(knownWords, learningWords) {
    function extractUniqueKanjiSet(words) {
      const set = new Set();
      if (!Array.isArray(words) || words.length === 0) return set;
      for (const word of words) {
        for (const ch of word) {
          if (KANJI_REGEX.test(ch)) set.add(ch);
        }
      }
      return set;
    }

    const knownKanjiSet = extractUniqueKanjiSet(knownWords);
    const learningKanjiSet = extractUniqueKanjiSet(learningWords);
    const learningOnlySet = new Set(
      [...learningKanjiSet].filter((k) => !knownKanjiSet.has(k))
    );

    return {
      knownKanjiSet,
      learningKanjiSet: learningOnlySet,
      knownKanji: [...knownKanjiSet],
      learningKanji: [...learningOnlySet],
      totalKnown: knownKanjiSet.size,
      totalLearning: learningOnlySet.size,
    };
  }

  async function getFilteredKanji(filterId, knownKanji, learningKanji) {
    if (filterId === 0) {
      return [...knownKanji, ...learningKanji].map((k) => [k, "All"]);
    }

    if (FILTER_CACHE.has(filterId)) {
      logInfo(`Using cached filter results for filterId=${filterId}`);
      return FILTER_CACHE.get(filterId);
    }

    let kanjiDb = null;
    try {
      kanjiDb = await initKanjiDB();
    } catch (err) {
      logError("getFilteredKanji: initKanjiDB failed:", err);
      return [];
    }

    if (!kanjiDb) {
      logError("getFilteredKanji: kanji DB is not available");
      return [];
    }

    return new Promise((resolve) => {
      try {
        const filter = FILTER_OPTIONS[filterId];

        const column = filter.column;
        const order = filter.order || "ASC";

        let whereClause = `WHERE ${column} IS NOT NULL`;
        if (filter.filter) {
          whereClause += ` AND ${filter.filter}`;
        }

        const query = `
          SELECT character, ${column} AS level
          FROM characters
          ${whereClause}
          ORDER BY ${column} ${order};
        `;

        const results = kanjiDb.exec(query);
        const filteredKanji = results.length > 0 ? results[0].values : [];
        FILTER_CACHE.set(filterId, filteredKanji);
        resolve(filteredKanji);
      } catch (err) {
        logError("Failed to run SQL query in getFilteredKanji:", err);
        resolve([]);
      }
    });
  }

  // App initialization
  const initVueApp = async () => {
    try {
      try {
        const mgkSrs = await waitForElement(SELECTORS.MIGAKU_SRS);
        if (!mgkSrs) {
          logWarn(
            "MIGAKU-SRS element not found - cannot determine language. Aborting mount."
          );
          return null;
        }
        const selectedLang = mgkSrs.getAttribute(ATTRIBUTES.LANGUAGE);
        if (selectedLang !== "ja") {
          logInfo(
            "Current language is not Japanese (",
            selectedLang,
            ") - skipping mount."
          );
          return null;
        }
      } catch (e) {
        logError("Language detection failed, aborting mount:", e);
        return null;
      }
      const vue = unsafeWindow.Vue || Vue;
      unsafeWindow.Vue = vue;
      if (!vue) {
        logError("Vue is not available in the current context.");
        return;
      }

      const uiPageLayout = await waitForElement(SELECTORS.UI_PAGE_LAYOUT);
      if (!uiPageLayout) {
        logWarn(
          "Could not find UI page layout (",
          SELECTORS.UI_PAGE_LAYOUT,
          "). Aborting app mount."
        );
        return;
      }
      const statisticsDiv = await waitForElement(SELECTORS.STATISTIC);
      if (!statisticsDiv) {
        logWarn(
          "Statistics element not found (",
          SELECTORS.STATISTIC,
          "), cannot display stats."
        );
        return null;
      }
      const componentHash = statisticsDiv.attributes[0].nodeName;
      if (document.getElementById(SELECTORS.MOUNT_ID)) {
        logWarn(SELECTORS.MOUNT_ID, "already exists. Skipping app mount.");
        return;
      }

      const mksContainer = document.createElement("div");
      mksContainer.id = SELECTORS.MOUNT_ID;
      mksContainer.setAttribute("custom-stat", "kanji-addon");
      mksContainer.setAttribute("minW", "6");
      mksContainer.setAttribute("minH", "7");
      mksContainer.setAttribute("defaultW", "6");
      mksContainer.setAttribute("defaultH", "9");

      uiPageLayout.appendChild(mksContainer);
      APP_STATE.MOUNT_ELEMENT = mksContainer;

      const App = {
        components: {
          FilterSelector,
          GroupedKanjiGrid,
        },
        data() {
          return {
            componentHash,
            kanjiStats: {
              knownKanjiCount: 0,
              learningKanjiCount: 0,
              knownKanji: [],
              learningKanji: [],
            },
            knownKanjiSet: null,
            learningKanjiSet: null,
            kanjiFilters: {
              filters: FILTER_OPTIONS,
              selectedFilterId: 0,
            },
            filteredKanji: [],
            filterId: 0,
            loading: true,
          };
        },
        computed: {
          componentAttrs() {
            return { [this.componentHash]: true };
          },
        },
        template: `
    <div id="MKS-container">
      <h2 v-bind="componentAttrs" class="UiTypo UiTypo__heading2 -heading Statistic__title">Migaku Kanji Stats</h2>
  <div v-if="loading" v-bind="componentAttrs" class="UiCard -lesson Statistic__card kanji-stats">Loading Kanji Statistics...</div>
  <div v-else v-bind="componentAttrs" class="UiCard -lesson Statistic__card kanji-stats">
        <div>
      <div v-bind="componentAttrs" class="Statistic__card__header header-relative">
        <h3 v-bind="componentAttrs" class="UiTypo UiTypo__heading3 -heading">Kanji Count</h3>
        <button id="mks-refresh-btn" v-bind="componentAttrs" class="UiButton -plain -icon-only -icon-left -floating" @click="handleRefresh" title="Refresh data" aria-label="Refresh data" type="button">
          <div class="UiButton__icon">
            <div class="UiIcon" style="width: 24px;">
              <div class="UiIcon__inner">
                <div class="UiSvg UiIcon__svg" name="Refresh" gradient="false" spin="false">
                  <div class="UiSvg__inner">
                    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">
                      <path fill="currentColor" d="M12 4V1L8 5l4 4V6c3.86 0 7 3.14 7 7 0 .73-.11 1.44-.31 2.09l1.71 1.02C20.83 14.04 21 13.04 21 12c0-4.97-4.03-9-9-9zM6.31 7.91 4.6 6.89C3.17 8.96 3 10.96 3 12c0 4.97 4.03 9 9 9v3l4-4-4-4v3c-3.86 0-7-3.14-7-7 0-.73.11-1.44.31-2.09z"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="UiButton__text"></div>
        </button>
            </div>
            <div>
                <span class="UiTypo UiTypo__caption -inline">Known Kanji: </span>
                <span class="UiTypo UiTypo__heading4 -heading -inline">{{ knownKanjiCount }}</span>
            </div>
            <div>
                <span class="UiTypo UiTypo__caption -inline">Learning Kanji: </span>
                <span class="UiTypo UiTypo__heading4 -heading -inline">{{ learningKanjiCount }}</span>
            </div>
            <div>
                <span class="UiTypo UiTypo__caption -inline">Total Kanji Encountered: </span>
                <span class="UiTypo UiTypo__heading4 -heading -inline">{{ knownKanjiCount + learningKanjiCount }}</span>
            </div>
        </div>
        <FilterSelector
                :filters="kanjiFilters.filters"
                :selected-filter-id="kanjiFilters.selectedFilterId"
                :component-hash="componentHash"
                @filter-selected="handleFilterSelected"
              />
        <GroupedKanjiGrid
          :filterId="filterId"
          :knownKanji="knownKanji"
          :learningKanji="learningKanji"
          :known-kanji-set="knownKanjiSet"
          :learning-kanji-set="learningKanjiSet"
          :filteredKanji="filteredKanji"
          :component-hash="componentHash"
        />
    </div>
</div>

`,
        methods: {
          async fetchKanjiStats() {
            try {
              this.loading = true;
              logInfo("Fetching kanji stats from migakuDB...");
              const knownWords = await getWordsByStatus(WORD_STATUS.KNOWN);
              const learningWords = await getWordsByStatus(
                WORD_STATUS.LEARNING
              );
              const kanjiStats = calculateKanjiStats(knownWords, learningWords);

              this.knownKanjiCount = kanjiStats.totalKnown;
              this.learningKanjiCount = kanjiStats.totalLearning;
              this.knownKanji = kanjiStats.knownKanji;
              this.learningKanji = kanjiStats.learningKanji;
              this.knownKanjiSet = kanjiStats.knownKanjiSet;
              this.learningKanjiSet = kanjiStats.learningKanjiSet;

              logInfo("Kanji stats loaded.");
            } catch (err) {
              logError("Error fetching kanji stats:", err);
            } finally {
              this.loading = false;
            }
          },
          async handleFilterSelected(filterId) {
            if (this.kanjiFilters.selectedFilterId === filterId) return;

            this.kanjiFilters.selectedFilterId = filterId;
            logInfo(`Selected ${filterId}`);
            this.loading = true;

            try {
              this.filteredKanji = await getFilteredKanji(
                filterId,
                this.knownKanji,
                this.learningKanji
              );
              this.filterId = filterId;
            } catch (err) {
              logError("Error applying filters:", err);
            } finally {
              this.loading = false;
            }
          },
          async handleRefresh() {
            try {
              this.loading = true;
              logInfo(
                "Refresh requested: clearing caches and reloading data..."
              );
              try {
                cleanupResources();
              } catch (e) {
                logError("cleanupResources error:", e);
              }

              await this.fetchKanjiStats();
              this.filteredKanji = await getFilteredKanji(
                this.kanjiFilters.selectedFilterId,
                this.knownKanji,
                this.learningKanji
              );
              logInfo("Refresh complete.");
            } catch (err) {
              logError("Error during refresh:", err);
            } finally {
              this.loading = false;
            }
          },
        },
        async mounted() {
          await this.fetchKanjiStats();
          this.filteredKanji = await getFilteredKanji(
            this.kanjiFilters.selectedFilterId,
            this.knownKanji,
            this.learningKanji
          );
        },
      };

      const app = unsafeWindow.Vue.createApp(App);
      APP_STATE.VUE_APP = app;
      try {
        app.mount(APP_STATE.MOUNT_ELEMENT);
      } catch (mountErr) {
        logWarn(
          "Mount by element reference failed, falling back to selector mount:",
          mountErr
        );
        app.mount("#" + SELECTORS.MOUNT_ID);
      }

      logInfo("Vue app mounted successfully.");
    } catch (err) {
      logError("Error during Vue app initialization:", err);
    }
  };

  function unmountVueApp() {
    try {
      if (APP_STATE.VUE_APP) {
        try {
          APP_STATE.VUE_APP.unmount();
          logInfo("Vue app unmounted.");
        } catch (e) {
          logError("Error unmounting Vue app:", e);
        }
        APP_STATE.VUE_APP = null;
      }

      try {
        if (APP_STATE.MOUNT_ELEMENT && APP_STATE.MOUNT_ELEMENT.parentElement) {
          APP_STATE.MOUNT_ELEMENT.parentElement.removeChild(
            APP_STATE.MOUNT_ELEMENT
          );
          logInfo("Removed mount container (by reference).");
        } else {
          const existing = document.getElementById(SELECTORS.MOUNT_ID);
          if (existing && existing.parentElement) {
            existing.parentElement.removeChild(existing);
            logInfo("Removed mount container (by id).");
          }
        }
      } finally {
        APP_STATE.MOUNT_ELEMENT = null;
      }

      try {
        cleanupResources();
      } catch (e) {
        logError("cleanupResources error during unmount:", e);
      }
    } catch (err) {
      logError("unmountVueApp error:", err);
    }
  }

  try {
    if (typeof window !== "undefined") {
      window.addEventListener("unload", () => {
        try {
          cleanupResources({ closeKanjiDb: true, closeIndexedDb: true });
        } catch (e) {
          logError("Error running cleanupResources on unload:", e);
        }
        try {
          SQL_ENGINE = null;
        } catch (e) {
          logError("Error nulling SQL_ENGINE on unload:", e);
        }
      });
    }
  } catch (e) {
    logError("Failed to attach unload handler:", e);
  }

  // Navigation handling
  const statsRoute = "/statistic";
  const appState = { previousRoute: window.location.pathname };

  let _initVueAppTimer = null;
  function initVueAppDebounced() {
    if (_initVueAppTimer) clearTimeout(_initVueAppTimer);
    _initVueAppTimer = setTimeout(() => {
      try {
        initVueApp();
      } catch (e) {
        logError("initVueAppDebounced initVueApp error:", e);
      }
    }, 50);
  }

  if (!history._mksPatched) {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function () {
      const previousPath = appState.previousRoute;
      const result = originalPushState.apply(this, arguments);
      const currentPath = window.location.pathname;
      appState.previousRoute = currentPath;

      logInfo(`Route changed from ${previousPath} to ${currentPath}`);

      if (currentPath === statsRoute && previousPath !== statsRoute) {
        logInfo("Entered statistics page");
      }

      setTimeout(initVueAppDebounced, 0);
      return result;
    };

    history.replaceState = function () {
      const previousPath = appState.previousRoute;
      const result = originalReplaceState.apply(this, arguments);
      const currentPath = window.location.pathname;
      appState.previousRoute = currentPath;

      logInfo(`Route replaced from ${previousPath} to ${currentPath}`);

      if (currentPath === statsRoute && previousPath !== statsRoute) {
        logInfo("Entered statistics page (replaceState)");
      }

      setTimeout(initVueAppDebounced, 0);
      return result;
    };

    window.addEventListener("popstate", () => {
      const previousPath = appState.previousRoute;
      const currentPath = window.location.pathname;
      appState.previousRoute = currentPath;
      logInfo(`Route popped from ${previousPath} to ${currentPath}`);

      if (currentPath === statsRoute && previousPath !== statsRoute) {
        logInfo("Entered statistics page (popstate)");
      }

      try {
        initVueAppDebounced();
      } catch (e) {
        logError("Error running initVueApp on popstate:", e);
      }
    });

    history._mksPatched = true;
  }

  // Language change observer
  async function observeLanguageChanges() {
    try {
      if (APP_STATE.LANGUAGE_OBSERVER) return;
      const mgkSrs = await waitForElement(SELECTORS.MIGAKU_SRS);
      if (!mgkSrs) {
        logInfo(
          "observeLanguageChanges: .MIGAKU-SRS element not found. Skipping language observer."
        );
        return;
      }

      const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (
            m.type === "attributes" &&
            m.attributeName === ATTRIBUTES.LANGUAGE
          ) {
            const newLang = mgkSrs.getAttribute(ATTRIBUTES.LANGUAGE);
            logInfo("Language attribute changed:", newLang);
            if (newLang === "ja") {
              try {
                initVueApp();
              } catch (e) {
                logError("Error mounting app after language change:", e);
              }
            } else {
              try {
                unmountVueApp();
              } catch (e) {
                logError("Error unmounting app after language change:", e);
              }
            }
          }
        }
      });

      mo.observe(mgkSrs, {
        attributes: true,
        attributeFilter: [ATTRIBUTES.LANGUAGE],
      });
      APP_STATE.LANGUAGE_OBSERVER = mo;
      logInfo("Language observer attached.");
    } catch (err) {
      logError("observeLanguageChanges error:", err);
    }
  }

  observeLanguageChanges();
})();
