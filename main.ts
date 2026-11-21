// main.ts — original Sokoban solver for make.fun sokoban-solver-01-run-20261121.
//
// Written from first principles for this competition (no copied solver code).
//
// Structure of the levels (from the kit's RULES.txt, read for understanding):
// a hallway one square wide with rooms off it, each room opening through a
// single door. A box pushed out of a door can never be pushed back, so every
// box stays in its room and the level's push-optimum P* is the sum of the
// rooms' optima. The solver therefore
//   1. finds the rooms (the floor minus the hallway row splits into one
//      component per room; a fallback cut test covers odd layouts),
//   2. solves each room push-optimally on its own,
//   3. stitches the rooms together with walks along the hallway.
//
// Each room is solved with A* over pushes. A state is the sorted box cells
// plus the player's reachable region (canonicalised to its lowest cell, so
// states that differ only in where the player stands inside one region are
// one state). The heuristic is the minimum-cost assignment of boxes to goals
// on static walking distances (admissible: one push moves one box one cell).
// Dead squares (reverse pull-reachability from the goals) and 2x2 freeze
// deadlocks prune the search. Budgets are fixed expansion counts, never the
// wall clock, so two executions write the same bytes.
//
// Scoring note: an instance is worth 1,000 points only in exactly P*
// pushes, and 500*P*/pushes in more, so push-optimality per room is what
// matters; the number of walking steps is irrelevant to the score.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fixed expansion budgets (deterministic: never the wall clock).
const ROOM_BUDGET = 1500000;
const WHOLE_BUDGET = 400000;

const DIRS = [
  [0, -1, 'u'],
  [0, 1, 'd'],
  [-1, 0, 'l'],
  [1, 0, 'r'],
];

// ---------------------------------------------------------------- parsing

function parseLevel(text) {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const rw = Math.max(...rows.map((r) => r.length));
  const rh = rows.length;
  // Pad with a one-cell wall border so neighbour indices never leave the grid.
  const w = rw + 2;
  const h = rh + 2;
  const size = w * h;
  const wall = new Uint8Array(size).fill(1);
  const goal = new Uint8Array(size);
  const boxes = [];
  let player = -1;
  rows.forEach((row, y) => {
    for (let x = 0; x < rw; x++) {
      const ch = row[x] ?? '#';
      const i = (y + 1) * w + (x + 1);
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  boxes.sort((a, b) => a - b);
  return { w, h, size, wall, goal, boxes, player };
}

// Neighbour offset of direction k.
const off = (L, k) => DIRS[k][1] * L.w + DIRS[k][0];
const letterOf = (L, d) => (d === -L.w ? 'u' : d === L.w ? 'd' : d === -1 ? 'l' : 'r');

// Flood fill from `from` over cells that are neither wall nor occupied.
// Returns { seen, min }: the reachable set and its lowest cell index.
function flood(L, wall, occupied, from) {
  const seen = new Uint8Array(L.size);
  const cells = [from];
  seen[from] = 1;
  let min = from;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    for (let k = 0; k < 4; k++) {
      const q = c + off(L, k);
      if (!wall[q] && !occupied[q] && !seen[q]) {
        seen[q] = 1;
        if (q < min) min = q;
        cells.push(q);
      }
    }
  }
  return { seen, min };
}

// Shortest walk (letters) from `from` to `to` over non-wall cells avoiding
// `boxes` (a Set of cell indices). Deterministic neighbour order. Null if
// unreachable. `wall` already encodes any region restriction.
function bfsPath(L, wall, boxes, from, to) {
  if (from === to) return '';
  const prev = new Int32Array(L.size).fill(-1);
  const prevDir = new Int8Array(L.size).fill(-1);
  const queue = [from];
  prev[from] = from;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    for (let k = 0; k < 4; k++) {
      const q = c + off(L, k);
      if (wall[q] || boxes.has(q) || prev[q] !== -1) continue;
      prev[q] = c;
      prevDir[q] = k;
      if (q === to) {
        let s = '';
        for (let t = to; t !== from; t = prev[t]) s = DIRS[prevDir[t]][2] + s;
        return s;
      }
      queue.push(q);
    }
  }
  return null;
}

// ------------------------------------------------------- room detection

// Primary: the hallway is the player's row (it spans the full width); the
// floor minus that row splits into one component per room.
function detectRoomsHallway(L) {
  const { w, size, wall, goal, boxes, player } = L;
  const hallY = (player / w) | 0;
  // The hallway row must hold one contiguous run of floor (the row spans
  // the board; the padding adds a wall column on each side, so the run need
  // not start at x = 1).
  let firstFloor = -1;
  let lastFloor = -1;
  for (let x = 0; x < w; x++) {
    if (!wall[hallY * w + x]) {
      if (firstFloor < 0) firstFloor = x;
      lastFloor = x;
    }
  }
  if (firstFloor < 0) return null;
  for (let x = firstFloor; x <= lastFloor; x++) if (wall[hallY * w + x]) return null;
  const boxSet = new Set(boxes);
  const comp = new Int32Array(size).fill(-1);
  const rooms = [];
  for (let s = 0; s < size; s++) {
    if (wall[s] || (s / w | 0) === hallY || comp[s] !== -1) continue;
    // New component: flood fill.
    const cells = [s];
    comp[s] = rooms.length;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      for (let k = 0; k < 4; k++) {
        const q = c + off(L, k);
        if (!wall[q] && (q / w | 0) !== hallY && comp[q] === -1) {
          comp[q] = rooms.length;
          cells.push(q);
        }
      }
    }
    const roomBoxes = [];
    const roomGoals = [];
    let door = -1;
    let staging = -1;
    for (const c of cells) {
      if (boxSet.has(c)) roomBoxes.push(c);
      if (goal[c]) roomGoals.push(c);
      for (let k = 0; k < 4; k++) {
        const q = c + off(L, k);
        if ((q / w | 0) === hallY && !wall[q]) {
          if (door >= 0 && door !== c) return null; // two doors: not a room
          door = c;
          staging = q;
        }
      }
    }
    roomBoxes.sort((a, b) => a - b);
    roomGoals.sort((a, b) => a - b);
    if (roomBoxes.length === 0) continue; // hallway-side scrap, no room
    if (roomBoxes.length !== roomGoals.length) return null;
    if (roomBoxes.length > 6 || cells.length > 40) return null;
    if (door < 0) return null;
    rooms.push({ cells, boxes: roomBoxes, goals: roomGoals, door, staging });
  }
  return rooms;
}

// Fallback: a door is a floor cell whose removal separates a small component
// holding as many boxes as goals from the player. Prefers the smallest such
// components and keeps box sets disjoint.
function detectRoomsCut(L) {
  const { w, size, wall, goal, boxes, player } = L;
  const boxSet = new Set(boxes);
  const floorCells = [];
  for (let i = 0; i < size; i++) if (!wall[i]) floorCells.push(i);
  const candidates = [];
  const compId = new Int32Array(size);
  for (const c of floorCells) {
    compId.fill(-1);
    let nComp = 0;
    for (const s of floorCells) {
      if (s === c || compId[s] !== -1) continue;
      const stack = [s];
      compId[s] = nComp;
      for (let i = 0; i < stack.length; i++) {
        const cur = stack[i];
        for (let k = 0; k < 4; k++) {
          const q = cur + off(L, k);
          if (q === c || wall[q] || compId[q] !== -1) continue;
          compId[q] = nComp;
          stack.push(q);
        }
      }
      nComp++;
    }
    const playerComp = compId[player];
    for (let ci = 0; ci < nComp; ci++) {
      if (ci === playerComp) continue;
      const cells = [];
      let nBox = 0;
      let nGoal = 0;
      let minX = 1e9;
      let maxX = -1e9;
      let minY = 1e9;
      let maxY = -1e9;
      for (const s of floorCells) {
        if (compId[s] !== ci) continue;
        cells.push(s);
        const x = s % w;
        const y = (s / w) | 0;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (boxSet.has(s)) nBox++;
        if (goal[s]) nGoal++;
      }
      if (boxSet.has(c)) nBox++;
      if (goal[c]) nGoal++;
      if (nBox < 3 || nBox !== nGoal || nBox > 6) continue;
      if (cells.length > 40 || maxX - minX > 6 || maxY - minY > 6) continue;
      let adjacent = false;
      let staging = -1;
      for (let k = 0; k < 4; k++) {
        const q = c + off(L, k);
        if (compId[q] === ci) adjacent = true;
        else if (!wall[q] && compId[q] === playerComp) staging = q;
      }
      if (!adjacent || staging < 0) continue;
      cells.sort((a, b) => a - b);
      candidates.push({ cells, boxes: null, goals: null, door: c, staging, nBox });
    }
  }
  candidates.sort((a, b) => a.cells.length - b.cells.length);
  const claimed = new Set();
  const rooms = [];
  for (const cand of candidates) {
    const roomBoxes = [];
    const roomGoals = [];
    for (const c of cand.cells) {
      if (boxSet.has(c)) roomBoxes.push(c);
      if (goal[c]) roomGoals.push(c);
    }
    if (boxSet.has(cand.door)) roomBoxes.push(cand.door);
    if (goal[cand.door]) roomGoals.push(cand.door);
    roomBoxes.sort((a, b) => a - b);
    roomGoals.sort((a, b) => a - b);
    if (roomBoxes.length !== roomGoals.length) continue;
    if (roomBoxes.some((b) => claimed.has(b))) continue;
    roomBoxes.forEach((b) => claimed.add(b));
    // The room's floor is the component plus its door cell.
    const allCells = [...cand.cells, cand.door].sort((a, b) => a - b);
    rooms.push({ cells: allCells, boxes: roomBoxes, goals: roomGoals, door: cand.door, staging: cand.staging });
  }
  return rooms;
}

function detectRooms(L) {
  let rooms = detectRoomsHallway(L);
  const covered = (rs) => {
    if (!rs) return false;
    const n = rs.reduce((a, r) => a + r.boxes.length, 0);
    return n === L.boxes.length;
  };
  if (!covered(rooms)) {
    const alt = detectRoomsCut(L);
    if (covered(alt)) rooms = alt;
  }
  return covered(rooms) ? rooms : null;
}

// ------------------------------------------------------------ room solver

// Precompute, for one room: static walking distances from every floor cell
// to each goal, dead squares, and the 2x2 blocks touching each cell.
function roomPrep(L, room) {
  const { size, wall, goal } = L;
  const floor = new Uint8Array(size);
  for (const c of room.cells) floor[c] = 1;
  floor[room.staging] = 1;
  // The search's walls are the level's walls plus everything outside the room.
  const roomWall = new Uint8Array(size);
  for (let i = 0; i < size; i++) roomWall[i] = wall[i] || !floor[i] ? 1 : 0;
  const nGoals = room.goals.length;
  // dist[j][cell]: walking distance from cell to goal j, ignoring boxes.
  const dist = [];
  for (let j = 0; j < nGoals; j++) {
    const d = new Int32Array(size).fill(-1);
    const queue = [room.goals[j]];
    d[room.goals[j]] = 0;
    for (let i = 0; i < queue.length; i++) {
      const c = queue[i];
      for (let k = 0; k < 4; k++) {
        const q = c + off(L, k);
        if (!roomWall[q] && d[q] < 0) {
          d[q] = d[c] + 1;
          queue.push(q);
        }
      }
    }
    dist.push(d);
  }
  // Dead squares: reverse pull-reachability from the goals. A box on a cell
  // outside this set can never reach a goal (real pushes are a subset of
  // these abstract reverse steps, which ignore other boxes and the player).
  const reach = new Uint8Array(size);
  const queue = [...room.goals];
  for (const g of room.goals) reach[g] = 1;
  for (let i = 0; i < queue.length; i++) {
    const n = queue[i];
    for (let k = 0; k < 4; k++) {
      const d = off(L, k);
      const b = n - d;
      if (floor[b] && !reach[b] && !roomWall[b - d]) {
        reach[b] = 1;
        queue.push(b);
      }
    }
  }
  const dead = new Uint8Array(size);
  for (let i = 0; i < size; i++) if (floor[i] && !reach[i]) dead[i] = 1;
  // 2x2 blocks: quads of cells, listed per cell they contain. A quad whose
  // four cells are all wall-or-box with a box off its goal is a freeze.
  const quadsByCell = Array.from({ length: size }, () => []);
  let minX = 1e9;
  let maxX = -1e9;
  let minY = 1e9;
  let maxY = -1e9;
  for (const c of room.cells) {
    const x = c % L.w;
    const y = (c / L.w) | 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const a = y * L.w + x;
      const b = a + 1;
      const c = a + L.w;
      const d = c + 1;
      for (const cell of [a, b, c, d]) quadsByCell[cell].push([a, b, c, d]);
    }
  }
  return { floor, roomWall, dist, dead, quadsByCell, nGoals };
}

// Minimum-cost assignment of boxes to goals (permutations; rooms hold at
// most 6 boxes, the whole-level fallback uses the sum-of-minima bound).
// Both are admissible lower bounds on the pushes still needed.
function heuristic(prep, boxes) {
  const n = boxes.length;
  if (n > 5) {
    let sum = 0;
    for (const b of boxes) {
      let m = Infinity;
      for (let j = 0; j < prep.nGoals; j++) {
        const d = prep.dist[j][b];
        if (d >= 0 && d < m) m = d;
      }
      if (m === Infinity) return Infinity;
      sum += m;
    }
    return sum;
  }
  // Heap's algorithm over goal permutations, iterative; the first n entries
  // of each full permutation cover every injective box->goal assignment.
  const perm = [];
  for (let j = 0; j < prep.nGoals; j++) perm.push(j);
  let best = Infinity;
  const evalPerm = () => {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const d = prep.dist[perm[i]][boxes[i]];
      if (d < 0) return;
      s += d;
      if (s >= best) return;
    }
    if (s < best) best = s;
  };
  const m = prep.nGoals;
  const c = new Array(m).fill(0);
  evalPerm();
  let i = 0;
  while (i < m) {
    if (c[i] < i) {
      const j = i % 2 === 0 ? 0 : c[i];
      [perm[j], perm[i]] = [perm[i], perm[j]];
      evalPerm();
      c[i]++;
      i = 0;
    } else {
      c[i] = 0;
      i++;
    }
  }
  return best;
}

// A* over pushes for one room. Returns { moves, endPlayer, expansions } or
// null when the budget runs out or the room cannot be solved.
function solveRoom(L, room, maxExpansions) {
  const prep = roomPrep(L, room);
  const startBoxes = room.boxes.slice().sort((a, b) => a - b);
  const goalSet = new Set(room.goals);
  const forbidden = room.forbidden ?? -1; // a cell a box may never be pushed to
  // A box on a dead square (or a frozen 2x2) at the start means unsolvable.
  for (const b of startBoxes) if (prep.dead[b]) return null;
  const isGoalState = (boxes) => boxes.every((b) => goalSet.has(b));
  if (isGoalState(startBoxes)) return { moves: '', endPlayer: room.staging, expansions: 0 };

  const boxesList = [startBoxes];
  const playerList = [room.staging];
  const parentList = [-1];
  const pushFromList = [-1];
  const pushToList = [-1];
  const gList = [0];
  const fList = [heuristic(prep, startBoxes)];
  const keyList = [];
  const closed = new Map();
  const occ0 = new Uint8Array(L.size);
  for (const b of startBoxes) occ0[b] = 1;
  const r0 = flood(L, prep.roomWall, occ0, room.staging);
  const key0 = String.fromCharCode(...startBoxes, r0.min);
  keyList.push(key0);
  closed.set(key0, 0);
  if (fList[0] === Infinity) return null;

  // Binary heap of state indices: smaller f first, then larger g, then older.
  const heap = [0];
  const less = (a, b) =>
    fList[a] < fList[b] ||
    (fList[a] === fList[b] && (gList[a] > gList[b] || (gList[a] === gList[b] && a < b)));
  const heapPush = (t) => {
    let i = heap.length;
    heap.push(t);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!less(heap[i], heap[p])) break;
      [heap[i], heap[p]] = [heap[p], heap[i]];
      i = p;
    }
  };
  const heapPop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length > 0) {
      heap[0] = last;
      for (let i = 0; ; ) {
        let c = 2 * i + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && less(heap[c + 1], heap[c])) c++;
        if (!less(heap[c], heap[i])) break;
        [heap[i], heap[c]] = [heap[c], heap[i]];
        i = c;
      }
    }
    return top;
  };

  let expansions = 0;
  let goalState = -1;
  while (heap.length > 0) {
    const s = heapPop();
    if (closed.get(keyList[s]) !== s) continue; // stale: a better path exists
    const boxes = boxesList[s];
    if (isGoalState(boxes)) {
      goalState = s;
      break;
    }
    if (++expansions > maxExpansions) return null;
    const g = gList[s];
    const occ = new Uint8Array(L.size);
    for (const b of boxes) occ[b] = 1;
    const reach = flood(L, prep.roomWall, occ, playerList[s]);
    for (let j = 0; j < boxes.length; j++) {
      const b = boxes[j];
      for (let k = 0; k < 4; k++) {
        const d = off(L, k);
        const dest = b + d;
        if (!prep.floor[dest] || occ[dest] || dest === forbidden) continue;
        if (!reach.seen[b - d]) continue; // the player cannot stand to push
        if (prep.dead[dest]) continue;
        const nb = boxes.slice();
        nb[j] = dest;
        nb.sort((a, b2) => a - b2);
        const occ2 = occ.slice();
        occ2[b] = 0;
        occ2[dest] = 1;
        // 2x2 freeze: only quads holding the moved box can newly freeze.
        let frozen = false;
        for (const [a, b2, c2, d2] of prep.quadsByCell[dest]) {
          const cells = [a, b2, c2, d2];
          let blocked = 0;
          let badBox = false;
          for (const cell of cells) {
            if (prep.roomWall[cell]) blocked++;
            else if (occ2[cell]) {
              blocked++;
              if (!goalSet.has(cell)) badBox = true;
            }
          }
          if (blocked === 4 && badBox) {
            frozen = true;
            break;
          }
        }
        if (frozen) continue;
        const r2 = flood(L, prep.roomWall, occ2, b);
        const key = String.fromCharCode(...nb, r2.min);
        const prev = closed.get(key);
        if (prev !== undefined && gList[prev] <= g + 1) continue;
        const h = heuristic(prep, nb);
        if (h === Infinity) continue;
        const t = boxesList.length;
        boxesList.push(nb);
        playerList.push(b);
        parentList.push(s);
        pushFromList.push(b);
        pushToList.push(dest);
        gList.push(g + 1);
        fList.push(g + 1 + h);
        keyList.push(key);
        closed.set(key, t);
        heapPush(t);
      }
    }
  }
  if (goalState < 0) return null;

  // Reconstruct: walk the pushes back, then simulate forward, filling in
  // the player's walks between pushes with deterministic BFS paths.
  const pushes = [];
  for (let t = goalState; parentList[t] !== -1; t = parentList[t]) {
    pushes.push([pushFromList[t], pushToList[t]]);
  }
  pushes.reverse();
  let player = room.staging;
  const boxes = startBoxes.slice();
  const boxSet = new Set(boxes);
  let moves = '';
  for (const [from, to] of pushes) {
    const d = to - from;
    const stand = from - d;
    const path = bfsPath(L, prep.roomWall, boxSet, player, stand);
    if (path === null) return null; // cannot happen: the search verified reachability
    moves += path;
    moves += letterOf(L, d);
    boxSet.delete(from);
    boxSet.add(to);
    const j = boxes.indexOf(from);
    boxes[j] = to;
    boxes.sort((a, b) => a - b);
    player = from;
  }
  return { moves, endPlayer: player, expansions };
}

// ------------------------------------------------------------------ driver

function solveLevel(text) {
  const L = parseLevel(text);
  const rooms = detectRooms(L);
  if (rooms === null) {
    // Fallback: solve the whole level as one room (no forbidden cell).
    const whole = {
      cells: null,
      boxes: L.boxes.slice(),
      goals: null,
      door: -1,
      staging: L.player,
      forbidden: -1,
    };
    const goalCells = [];
    for (let i = 0; i < L.size; i++) if (L.goal[i]) goalCells.push(i);
    whole.goals = goalCells;
    const prep = roomPrepWhole(L);
    const sol = solveRoomWithPrep(L, whole, prep, WHOLE_BUDGET);
    return sol ? sol.moves : '';
  }
  rooms.sort((a, b) => a.door - b.door);
  let moves = '';
  let player = L.player;
  const globalBoxes = new Set(L.boxes);
  for (const room of rooms) {
    const sol = solveRoom(L, { ...room, forbidden: room.staging }, ROOM_BUDGET);
    if (sol === null) return ''; // one unsolved room zeroes the instance
    const walk = bfsPath(L, L.wall, globalBoxes, player, room.staging);
    if (walk === null) return '';
    moves += walk;
    moves += sol.moves;
    for (const b of room.boxes) globalBoxes.delete(b);
    for (const g of room.goals) globalBoxes.add(g);
    player = sol.endPlayer;
  }
  return moves;
}

// Whole-level fallback prep: the room floor is every floor cell.
function roomPrepWhole(L) {
  const floor = new Uint8Array(L.size);
  for (let i = 0; i < L.size; i++) if (!L.wall[i]) floor[i] = 1;
  return floor;
}

function solveRoomWithPrep(L, room, floor, maxExpansions) {
  // Reuse solveRoom by faking a room whose cells are all floor cells and
  // whose staging is the player's start; the room solver builds its own
  // prep from room.cells, so pass cells explicitly.
  const cells = [];
  for (let i = 0; i < L.size; i++) if (floor[i]) cells.push(i);
  return solveRoom(L, { cells, boxes: room.boxes, goals: room.goals, door: -1, staging: room.staging, forbidden: -1 }, maxExpansions);
}

for (const id of readdirSync(INPUT).sort()) {
  const moves = solveLevel(readFileSync(join(INPUT, id, 'level.txt'), 'utf8'));
  mkdirSync(join(OUTPUT, id), { recursive: true });
  writeFileSync(join(OUTPUT, id, 'solution.txt'), `${moves}\n`);
}
