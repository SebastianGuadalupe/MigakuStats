import { getStudyDate, getChartDayNumber } from '../src/utils/studyDay';
import { afterEach, beforeEach, expect, test, mock, setSystemTime } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import pako from 'pako';
import initSqlJs from 'sql.js';
import { readFileSync } from 'node:fs';
const SQL = await initSqlJs({ wasmBinary: readFileSync('node_modules/sql.js/dist/sql-wasm.wasm') });
mock.module('sql.js', () => ({ default: async () => SQL }));
const data = await import('../src/utils/database');
let fixture: ReturnType<typeof SQL.Database>;
const today = getStudyDate();
const day = Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(2020,0,1)) / 86400000);
beforeEach(async () => {
  data.clearDatabaseCache();
  globalThis.indexedDB = new IDBFactory();
  fixture = new SQL.Database();
  fixture.run(`
    CREATE TABLE deck(id INTEGER PRIMARY KEY, name TEXT, lang TEXT, del INTEGER);
    INSERT INTO deck VALUES (1,'A','ja',0),(2,'B','ja',0),(3,'Deleted','ja',1);
    CREATE TABLE card(id INTEGER PRIMARY KEY,deckId INTEGER,due INTEGER,interval REAL,del INTEGER,suspended INTEGER,created INTEGER,lessonId INTEGER,balancedDue INTEGER,seedDel INTEGER DEFAULT 0);
    CREATE TABLE WordList(dictForm TEXT,secondary TEXT,partOfSpeech TEXT,language TEXT,knownStatus TEXT,del INTEGER);
    CREATE TABLE CardWordRelation(cardId INTEGER,dictForm TEXT,secondary TEXT,partOfSpeech TEXT,language TEXT,del INTEGER);
    CREATE TABLE review(id INTEGER,cardId INTEGER,deckId INTEGER,day INTEGER,type INTEGER,del INTEGER,duration REAL,interval REAL);
    CREATE TABLE wordHistory(day INTEGER,dictForm TEXT,secondary TEXT,partOfSpeech TEXT,language TEXT,knownStatus TEXT,prevKnownStatus TEXT,del INTEGER);
    CREATE TABLE keyValue(key TEXT,entry TEXT);
  `);
});
async function publish() {
  fixture.run("UPDATE card SET balancedDue=due WHERE balancedDue IS NULL");
  const bytes = pako.gzip(fixture.export());
  fixture.close();
  await new Promise<void>((resolve,reject) => {
    const request = indexedDB.open('srs',1);
    request.onupgradeneeded = () => request.result.createObjectStore('data',{ keyPath:'path' });
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('data','readwrite');
      tx.objectStore('data').put({path:'srs',data:bytes});
      tx.oncomplete = () => {db.close();resolve()};
      tx.onerror = () => reject(tx.error);
    };
  });
}
test('parallel cards share a snapshot; deck filters and empty intervals work', async () => {
  fixture.run(`INSERT INTO WordList VALUES ('a','','noun','ja','KNOWN',0),('b','','noun','ja','LEARNING',0);
    INSERT INTO card(id,deckId,due,interval,del,suspended,created,lessonId) VALUES (1,1,${day},0.2,0,0,0,NULL),(2,2,${day},30,0,0,0,NULL);
    INSERT INTO CardWordRelation VALUES (1,'a','','noun','ja',0),(2,'b','','noun','ja',0);`);
  await publish();
  const [words, intervals, decks] = await Promise.all([data.fetchWordStats('ja','1'),data.fetchIntervalStats('ja','1','100th'),data.fetchAvailableDecks()]);
  expect(words?.known_count).toBe(1);
  expect(words?.learning_count).toBe(0);
  expect(intervals).toEqual({labels:['1 day'],counts:[1]});
  expect(decks?.map(d=>d.id)).toEqual(['all','1','2']);
  expect(await data.fetchIntervalStats('fr')).toEqual({labels:[],counts:[]});
});
test('due forecast excludes suspended, deleted-deck and unlearned cards', async () => {
  fixture.run(`INSERT INTO card(id,deckId,due,interval,del,suspended,created,lessonId) VALUES
    (1,1,${day},10,0,0,0,NULL), (2,1,${day},10,0,1,0,NULL),
    (3,3,${day},10,0,0,0,NULL), (4,1,${day},0,0,0,0,NULL),
    (5,2,${day+1},30,0,0,0,NULL);`);
  await publish();
  const result = await data.fetchDueStats('ja','1');
  expect(result?.counts.reduce((a,b)=>a+b,0)).toBe(1);
  expect(result?.counts[0]).toBe(1);
});
test('all-time review history includes epoch day zero', async () => {
  fixture.run(`INSERT INTO card(id,deckId,due,interval,del,suspended,created,lessonId) VALUES (1,1,${day},30,0,0,0,NULL);
    INSERT INTO review VALUES (1,1,1,0,2,0,10,30),(2,1,1,${day},1,0,20,30);`);
  await publish();
  const result = await data.fetchReviewHistory('ja','1','All time','Days');
  expect(result?.labels.length).toBe(day+1);
  expect(result?.counts.flat().reduce((a,b)=>a+b,0)).toBe(2);
});
test('word history handles transitions, grouping, and delimiter-containing word keys', async () => {
  fixture.run(`INSERT INTO wordHistory VALUES
    (${day-2},'a|b','c','','ja','KNOWN','UNKNOWN',0),
    (${day-2},'a','b|c','','ja','KNOWN','UNKNOWN',0),
    (${day-1},'a|b','c','','ja','UNKNOWN','KNOWN',0),
    (${day},'a|b','c','','ja','KNOWN','UNKNOWN',0);`);
  await publish();
  const cumulative = await data.fetchWordHistory('ja','all','All time','Days','cumulative');
  const daily = await data.fetchWordHistory('ja','all','All time','Days','daily');
  const monthly = await data.fetchWordHistory('ja','all','All time','Months','cumulative');
  expect(cumulative?.knownCounts).toEqual([2,1,2]);
  expect(daily?.knownCounts).toEqual([2,-1,1]);
  expect(monthly?.knownCounts.at(-1)).toBe(2);
});
test('weekly time averages are weighted by review count', async () => {
  fixture.run(`INSERT INTO card(id,deckId,due,interval,del,suspended,created,lessonId) VALUES (1,1,${day},30,0,0,0,NULL);
    INSERT INTO review VALUES (1,1,1,${day},2,0,10,30),(2,1,1,${day},2,0,20,30),(3,1,1,${day},2,0,60,30);`);
  await publish();
  const result = await data.fetchTimeHistory('ja','1','All time','Weeks','averages');
  expect(result?.reviewsTime.at(-1)).toBe(30);
});
test('opening an uninitialized Migaku database does not create it', async () => {
  expect(await data.fetchAvailableDecks()).toBeNull();
  expect(await indexedDB.databases()).toEqual([]);
});

test('tomorrow follows balancedDue, including deferred overdue cards and deck filtering', async () => {
  fixture.run(`INSERT INTO card(id,deckId,due,balancedDue,interval,del,suspended,seedDel) VALUES
    (1,1,${day+1},${day+3},30,0,0,0),
    (2,1,${day+3},${day+1},30,0,0,0),
    (3,1,${day-3},${day+1},10,0,0,0),
    (4,2,${day+1},${day+1},30,0,0,0),
    (5,1,${day+1},${day+1},30,0,0,1),
    (6,1,${day+1},0,30,0,0,0);`);
  await publish();
  const result = await data.fetchDueStats('ja','1');
  expect(result?.counts[1]).toBe(2);
  expect(result?.knownCounts?.[1]).toBe(1);
  expect(result?.learningCounts?.[1]).toBe(1);
  expect(result?.counts[3]).toBe(1);
  expect((await data.fetchDueStats('ja','all'))?.counts[1]).toBe(3);
});
test('an old app-review tracking date cannot shift tomorrow to a different day', async () => {
  fixture.run(`INSERT INTO keyValue VALUES ('study.activeDay.currentDate','2020-01-01');
    INSERT INTO card(id,deckId,due,interval,del,suspended,created,lessonId) VALUES (1,1,${day+1},30,0,0,0,NULL);`);
  await publish();
  const result=await data.fetchDueStats('ja','1');
  expect(result?.counts[0]).toBe(0);
  expect(result?.counts[1]).toBe(1);
  expect(result?.labels[0]).toBe(today.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}));
});
test('all-time forecast bounds use the adjusted date, not the original due date', async () => {
  fixture.run(`INSERT INTO card(id,deckId,due,balancedDue,interval,del,suspended,seedDel) VALUES
    (1,1,${day-10},${day+4000},30,0,0,0);`);
  await publish();
  const result=await data.fetchDueStats('ja','1','All time');
  expect(result?.counts.length).toBe(4001);
  expect(result?.counts[4000]).toBe(1);
});

afterEach(() => setSystemTime());
test('due and review history roll over at 04:00, not midnight', async () => {
  const previousDay=getChartDayNumber(new Date(2026,9,24));
  fixture.run(`INSERT INTO card(id,deckId,due,balancedDue,interval,del,suspended,seedDel) VALUES
    (1,1,${previousDay},${previousDay},30,0,0,0),
    (2,1,${previousDay+1},${previousDay+1},30,0,0,0);
    INSERT INTO review VALUES (1,1,1,${previousDay},2,0,10,30);`);
  await publish();
  setSystemTime(new Date(2026,9,25,3,59,59,999));
  const before=await data.fetchDueStats('ja','1');
  expect(before?.counts.slice(0,2)).toEqual([1,1]);
  expect(before?.labels[0]).toBe(new Date(2026,9,24).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}));
  const history=await data.fetchReviewHistory('ja','1','1 Month','Days');
  expect(history?.labels.at(-1)).toBe(before?.labels[0]);
  setSystemTime(new Date(2026,9,25,4,0,0));
  const after=await data.fetchDueStats('ja','1');
  expect(after?.counts.slice(0,2)).toEqual([1,0]);
  expect(after?.labels[0]).toBe(before?.labels[1]);
});
