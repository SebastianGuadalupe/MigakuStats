# Release v0.2.5 - Stats Loading Fix

## 🐛 Bug Fixes

### Fixed: Stats Not Loading for Some Users

This release addresses critical issues that prevented statistics from loading for users in certain regions or network conditions.

## 🎯 What's Fixed

### 1. **Multiple CDN Fallbacks**
- Added 3 CDN sources for SQL.js WASM file (jsDelivr, unpkg, Cloudflare)
- Automatically tries alternative CDNs if primary fails
- Dramatically improves accessibility for users in regions with CDN restrictions

### 2. **Automatic Retry System**
- Implements intelligent retry logic with 3 automatic attempts
- Exponential backoff delays (1s, 2s, 3s) between retries
- Gracefully handles temporary network issues without user intervention

### 3. **Manual Retry Buttons**
- Added "Retry" button to all 6 statistic components
- Users can manually trigger reload if automatic retry fails
- Button shows "Retrying..." state during reload attempts

### 4. **Improved Error Messages**
Replaced generic errors with specific, actionable messages:
- ✅ "Failed to load SQL.js engine. This may be due to network issues or CDN blocking..."
- ✅ "Migaku database not properly initialized. Please make sure Migaku is running..."
- ✅ "No Migaku data found in IndexedDB. Please ensure Migaku has synced your statistics..."
- ✅ "Failed to decompress Migaku database. The data may be corrupted..."

## 📊 Components Updated

All statistics components now have better error handling:
- Word Status (WordCount)
- Study Statistics
- Cards Due
- Review History
- Review Intervals  
- Time Statistics

## 🔧 Technical Details

### Files Modified:
- `src/utils/database.ts` - Core retry logic & CDN fallbacks
- `src/components/WordCount.vue` - Added retry functionality
- `src/components/StudyStatistics.vue` - Added retry functionality
- `src/components/CardsDue.vue` - Added retry functionality
- `src/components/ReviewHistory.vue` - Added retry functionality
- `src/components/ReviewIntervals.vue` - Added retry functionality
- `src/components/TimeChart.vue` - Added retry functionality

### Key Changes:
```typescript
// Multiple CDN sources with automatic fallback
const wasmCdns = [
  'https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/sql-wasm.wasm',
  'https://unpkg.com/sql.js@1.13.0/dist/sql-wasm.wasm',
  'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.13.0/sql-wasm.wasm',
];

// Automatic retry with exponential backoff
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // ms
```

## 💡 User Impact

### Before:
- ❌ Silent failures
- ❌ Generic "Could not load" errors
- ❌ No way to recover without page refresh
- ❌ CDN blocking caused permanent failures

### After:
- ✅ Automatic recovery from temporary issues
- ✅ Clear, actionable error messages
- ✅ Manual retry option on all components
- ✅ Works in regions with CDN restrictions

## 🌍 Improved Reliability

This release significantly improves reliability for users:
- **In China/regions with CDN restrictions**: Multiple CDN fallbacks ensure at least one works
- **On slow/unstable networks**: Automatic retry handles temporary drops
- **During CDN outages**: Fallback CDNs provide redundancy
- **With Migaku sync issues**: Clear error messages guide users to solution

## 📦 Installation

### New Users:
1. Install [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/)
2. Click on `migaku-more-stats.user.js` from this release
3. Click "Install" when prompted

### Existing Users:
Tampermonkey/Violentmonkey should auto-update within 24 hours, or:
1. Open Tampermonkey/Violentmonkey dashboard
2. Click "Check for updates"
3. Confirm the update to v0.2.5

## 🔗 Links

- **GitHub Repository**: https://github.com/SebastianGuadalupe/MigakuStats
- **Report Issues**: https://github.com/SebastianGuadalupe/MigakuStats/issues
- **Documentation**: See STATS_LOADING_FIX.md for technical details

## 🙏 Feedback

If you were experiencing stats loading issues, please let us know if this update resolves them! Open an issue on GitHub if you continue to experience problems.

---

**Full Changelog**: v0.2.4...v0.2.5

