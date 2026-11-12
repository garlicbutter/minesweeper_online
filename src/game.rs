use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[cfg(target_arch = "wasm32")]
#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn random_u32() -> u32;
    fn now_ms() -> f64;
}

pub fn now() -> u64 {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { now_ms() as u64 }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock before Unix epoch")
            .as_millis() as u64
    }
}
fn random() -> u32 {
    #[cfg(target_arch = "wasm32")]
    {
        unsafe { random_u32() }
    }
    #[cfg(not(target_arch = "wasm32"))]
    {
        rand::random()
    }
}
pub(crate) fn random_int(n: usize) -> usize {
    let range = 1u64 << 32;
    let limit = range - range % n as u64;
    loop {
        let value = random() as u64;
        if value < limit {
            return (value % n as u64) as usize;
        }
    }
}
fn token() -> String {
    (0..4).map(|_| format!("{:08x}", random())).collect()
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
pub struct Settings {
    pub width: usize,
    pub height: usize,
    pub mines: usize,
}
impl Settings {
    pub fn from_input(input: &Value) -> Result<Self, String> {
        let preset = match input["difficulty"].as_str() {
            Some("easy") => Some((9, 9, 10)),
            Some("medium") => Some((16, 16, 40)),
            Some("hard") => Some((30, 16, 99)),
            _ => None,
        };
        let value = |key: &str, default: usize| -> Result<usize, String> {
            if input[key].is_null() {
                return Ok(default);
            }
            input[key]
                .as_u64()
                .and_then(|v| usize::try_from(v).ok())
                .ok_or_else(|| "Map dimensions and mines must be positive whole numbers.".into())
        };
        let (width, height, mines) = if let Some(preset) = preset {
            preset
        } else {
            (
                value("width", 16)?,
                value("height", 16)?,
                value("mines", 40)?,
            )
        };
        if !(5..=40).contains(&width)
            || !(5..=30).contains(&height)
            || mines < 1
            || mines > width * height - 9
        {
            return Err("Use a width of 5–40, height of 5–30, and 1 to (cells − 9) mines.".into());
        }
        Ok(Self {
            width,
            height,
            mines,
        })
    }
    pub fn len(self) -> usize {
        self.width * self.height
    }
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }
    pub fn neighbors(self, index: usize) -> Vec<usize> {
        let (x, y) = ((index % self.width) as isize, (index / self.width) as isize);
        let mut result = Vec::with_capacity(8);
        for dy in -1..=1 {
            for dx in -1..=1 {
                let (nx, ny) = (x + dx, y + dy);
                if (dx != 0 || dy != 0)
                    && nx >= 0
                    && nx < self.width as isize
                    && ny >= 0
                    && ny < self.height as isize
                {
                    result.push(ny as usize * self.width + nx as usize);
                }
            }
        }
        result
    }
}

pub fn generate(s: Settings, openings: &[usize]) -> Vec<i8> {
    let mut safe: BTreeSet<usize> = openings.iter().copied().collect();
    for &index in openings {
        let mut expanded = safe.clone();
        expanded.extend(s.neighbors(index));
        if expanded.len() <= s.len() - s.mines {
            safe = expanded;
        }
    }
    let mut candidates: Vec<_> = (0..s.len()).filter(|i| !safe.contains(i)).collect();
    for i in (1..candidates.len()).rev() {
        let j = random_int(i + 1);
        candidates.swap(i, j);
    }
    let mut board = vec![0; s.len()];
    for &index in candidates.iter().take(s.mines) {
        board[index] = -1;
    }
    for i in 0..board.len() {
        if board[i] != -1 {
            board[i] = s.neighbors(i).iter().filter(|&&j| board[j] == -1).count() as i8;
        }
    }
    board
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Playing,
    Won,
    Lost,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Waiting,
    Playing,
    Finished,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Explosion {
    pub x: usize,
    pub y: usize,
    pub width: usize,
    pub height: usize,
    pub cells: Vec<usize>,
    pub at: u64,
    pub sequence: u32,
}

/// Opening components plus safe numbers outside every opening's boundary.
/// Solved units credit a revealed zero in each opening and revealed standalone numbers.
pub fn board_benchmark(settings: Settings, board: &[i8], revealed: &[usize]) -> (usize, usize) {
    let mut seen = vec![false; board.len()];
    let mut opening_cells = vec![false; board.len()];
    let mut visible = vec![false; board.len()];
    for &i in revealed {
        if i < visible.len() {
            visible[i] = true;
        }
    }
    let (mut total, mut solved) = (0, 0);
    for i in 0..board.len() {
        if board[i] != 0 || seen[i] {
            continue;
        }
        total += 1;
        let mut completed = false;
        let mut queue = vec![i];
        seen[i] = true;
        while let Some(cell) = queue.pop() {
            completed |= visible[cell];
            opening_cells[cell] = true;
            for neighbor in settings.neighbors(cell) {
                opening_cells[neighbor] = true;
                if board[neighbor] == 0 && !seen[neighbor] {
                    seen[neighbor] = true;
                    queue.push(neighbor);
                }
            }
        }
        solved += usize::from(completed);
    }
    for i in 0..board.len() {
        if board[i] > 0 && !opening_cells[i] {
            total += 1;
            solved += usize::from(visible[i]);
        }
    }
    (total, solved)
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClickCounts {
    pub reveals: u64,
    pub flags: u64,
    pub chords: u64,
}
impl ClickCounts {
    pub fn total(&self) -> u64 {
        self.reveals + self.flags + self.chords
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: String,
    pub name: String,
    pub ready: bool,
    #[serde(default)]
    pub bot: bool,
    #[serde(default)]
    pub bot_next_move_at: Option<u64>,
    #[serde(default)]
    pub settings: Option<Settings>,
    #[serde(default)]
    pub board: Option<Vec<i8>>,
    #[serde(default)]
    pub hits: u32,
    /// None for older saved rounds whose click history was not recorded.
    #[serde(default)]
    pub clicks: Option<ClickCounts>,
    #[serde(default)]
    pub explosion: Option<Explosion>,
    #[serde(default)]
    pub opening: Option<usize>,
    pub revealed: Vec<usize>,
    pub flags: Vec<usize>,
    pub status: Status,
    pub last_seen: u64,
}
impl Player {
    pub fn new(name: &str) -> Self {
        let name = name.trim().chars().take(24).collect::<String>();
        Self {
            id: token(),
            name: if name.is_empty() {
                "Player".into()
            } else {
                name
            },
            ready: false,
            bot: false,
            bot_next_move_at: None,
            settings: None,
            board: None,
            hits: 0,
            clicks: Some(ClickCounts::default()),
            explosion: None,
            opening: None,
            revealed: vec![],
            flags: vec![],
            status: Status::Playing,
            last_seen: now(),
        }
    }
    fn reset(&mut self) {
        self.ready = self.bot;
        self.bot_next_move_at = None;
        self.opening = None;
        self.board = None;
        self.revealed.clear();
        self.flags.clear();
        self.hits = 0;
        self.clicks = Some(ClickCounts::default());
        self.explosion = None;
        self.status = Status::Playing;
    }
    fn explode(&mut self, s: Settings, index: usize) {
        let width = s.width.min(6);
        let height = s.height.min(6);
        let x = (index % s.width).saturating_sub(2).min(s.width - width);
        let y = (index / s.width).saturating_sub(2).min(s.height - height);
        let cells: Vec<_> = (y..y + height)
            .flat_map(|row| (x..x + width).map(move |col| row * s.width + col))
            .collect();
        let area: BTreeSet<_> = cells.iter().copied().collect();
        let board = self
            .board
            .as_mut()
            .expect("explosion requires a generated board");
        let mines = cells.iter().filter(|&&i| board[i] == -1).count();
        // If there is space, make the clicked square safe so the shuffle necessarily changes.
        let mut candidates: Vec<_> = cells
            .iter()
            .copied()
            .filter(|&i| i != index || mines == cells.len())
            .collect();
        for i in (1..candidates.len()).rev() {
            let j = random_int(i + 1);
            candidates.swap(i, j);
        }
        for &i in &cells {
            board[i] = 0;
        }
        for &i in candidates.iter().take(mines) {
            board[i] = -1;
        }
        // Recompute globally: visible clues immediately outside the blast can also change.
        for i in 0..board.len() {
            if board[i] != -1 {
                board[i] = s.neighbors(i).iter().filter(|&&j| board[j] == -1).count() as i8;
            }
        }
        self.revealed.retain(|i| !area.contains(i));
        self.flags.retain(|i| !area.contains(i));
        self.status = Status::Playing;
        self.hits = self.hits.saturating_add(1);
        self.explosion = Some(Explosion {
            x,
            y,
            width,
            height,
            cells,
            at: now(),
            sequence: self.hits,
        });
    }
    fn reveal(&mut self, settings: Settings, board: &[i8], indices: &[usize]) {
        let mut seen = vec![false; board.len()];
        for &i in &self.revealed {
            seen[i] = true;
        }
        let mut flags = vec![false; board.len()];
        for &i in &self.flags {
            flags[i] = true;
        }
        let mut queue = indices.to_vec();
        while let Some(i) = queue.pop() {
            if seen[i] || flags[i] {
                continue;
            }
            seen[i] = true;
            self.revealed.push(i);
            if board[i] == -1 {
                self.status = Status::Lost;
                break;
            }
            if board[i] == 0 {
                queue.extend(settings.neighbors(i).into_iter().filter(|&j| !seen[j]));
            }
        }
        if self.status != Status::Lost && self.revealed.len() == board.len() - settings.mines {
            self.status = Status::Won;
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub code: String,
    pub settings: Settings,
    pub players: Vec<Player>,
    pub phase: Phase,
    pub solo: bool,
    pub board: Option<Vec<i8>>,
    #[serde(default)]
    pub available_at: Option<u64>,
    pub started_at: Option<u64>,
    #[serde(default)]
    pub finished_at: Option<u64>,
    pub winner: Option<String>,
    pub round: u32,
    pub created_at: u64,
    pub version: u64,
}
impl Room {
    pub fn new(input: &Value) -> Result<Self, String> {
        let alphabet = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let settings = Settings::from_input(input)?;
        let mut player = Player::new(input["name"].as_str().unwrap_or("Player"));
        player.settings = Some(settings);
        let solo = input["solo"].as_bool().unwrap_or(false);
        let mut players = vec![player];
        if input["bot"].as_bool().unwrap_or(false) {
            if solo {
                return Err("AI opponents require multiplayer mode.".into());
            }
            let bot_settings = if input["botSettings"].is_null() {
                settings
            } else {
                Settings::from_input(&input["botSettings"])?
            };
            let mut bot = Player::new("Test AI");
            bot.bot = true;
            bot.ready = true;
            bot.settings = Some(bot_settings);
            players.push(bot);
        }
        Ok(Self {
            code: (0..6)
                .map(|_| alphabet[random_int(alphabet.len())] as char)
                .collect(),
            settings,
            players,
            phase: Phase::Waiting,
            solo,
            board: None,
            available_at: None,
            started_at: None,
            finished_at: None,
            winner: None,
            round: 1,
            created_at: now(),
            version: 0,
        })
    }
    pub fn join(&mut self, name: &str) -> Result<String, String> {
        self.join_with_settings(name, self.settings)
    }
    pub fn join_with_settings(&mut self, name: &str, settings: Settings) -> Result<String, String> {
        if self.solo
            || self.phase != Phase::Waiting
            || self.players.len() >= 2
            || self.players.iter().any(|p| p.bot)
        {
            return Err("This room is full or the match has started.".into());
        }
        let mut p = Player::new(name);
        p.settings = Some(settings);
        let id = p.id.clone();
        self.players.push(p);
        self.version += 1;
        Ok(id)
    }
    fn finish(&mut self) {
        let winners: Vec<_> = self
            .players
            .iter()
            .filter(|p| p.status == Status::Won)
            .collect();
        let loser = self.players.iter().find(|p| p.status == Status::Lost);
        if winners.is_empty() && loser.is_none() {
            return;
        }
        self.winner = if winners.len() > 1 {
            None
        } else if let Some(winner) = winners.first() {
            Some(winner.id.clone())
        } else {
            self.players
                .iter()
                .find(|p| Some(p.id.as_str()) != loser.map(|p| p.id.as_str()))
                .map(|p| p.id.clone())
        };
        self.phase = Phase::Finished;
        self.finished_at = Some(now());
    }
    pub fn act(&mut self, id: &str, input: &Value) -> Result<(), String> {
        let pi = self
            .players
            .iter()
            .position(|p| p.id == id)
            .ok_or("This player is not in the room.")?;
        // Upgrade previous shared-board snapshots without discarding either player's progress.
        for p in &mut self.players {
            if p.settings.is_none() {
                p.settings = Some(self.settings);
            }
            if p.board.is_none() {
                p.board = self.board.clone();
            }
        }
        self.board = None;
        self.players[pi].last_seen = now();
        let action = input["type"].as_str().unwrap_or("");
        if action == "ping" {
            return Ok(());
        }
        match action {
            "settings" => {
                if self.phase != Phase::Waiting {
                    return Err("Choose your difficulty before the round starts.".into());
                }
                let settings = Settings::from_input(input)?;
                self.players[pi].reset();
                self.players[pi].settings = Some(settings);
                if pi == 0 {
                    self.settings = settings;
                }
            }
            "ready" => {
                if self.phase != Phase::Waiting {
                    return Err("The round has already started.".into());
                }
                if !self.players[pi].ready && !input["settings"].is_null() {
                    let settings = Settings::from_input(&input["settings"])?;
                    self.players[pi].settings = Some(settings);
                    if pi == 0 {
                        self.settings = settings;
                    }
                }
                self.players[pi].ready = !self.players[pi].ready;
                if self.players.len() == if self.solo { 1 } else { 2 }
                    && self.players.iter().all(|p| p.ready)
                {
                    self.available_at = Some(now() + if self.solo { 0 } else { 3000 });
                    self.started_at = if self.solo { None } else { self.available_at };
                    self.phase = Phase::Playing;
                }
            }
            "rematch" => {
                if self.phase != Phase::Finished || pi != 0 {
                    return Err("The host can start a rematch after the round.".into());
                }
                self.phase = Phase::Waiting;
                self.board = None;
                self.available_at = None;
                self.started_at = None;
                self.finished_at = None;
                self.winner = None;
                self.round += 1;
                for p in &mut self.players {
                    p.reset();
                }
            }
            "leave" => {
                if self.phase == Phase::Playing {
                    self.players[pi].status = Status::Lost;
                    self.finish();
                } else if self.phase == Phase::Waiting {
                    self.players.remove(pi);
                }
            }
            "flag" | "reveal" => {
                if self.phase != Phase::Playing
                    || now() < self.available_at.or(self.started_at).unwrap_or(0)
                    || self.players[pi].status != Status::Playing
                {
                    return Err("The board is not active.".into());
                }
                let p = &mut self.players[pi];
                let settings = p.settings.unwrap_or(self.settings);
                let index = input["index"]
                    .as_u64()
                    .and_then(|v| usize::try_from(v).ok())
                    .filter(|&i| i < settings.len())
                    .ok_or("Invalid cell.")?;
                // Count accepted tile activations, including wasted clicks and flag removal.
                // A chord is one activation, even when it opens several cells.
                if let Some(clicks) = &mut p.clicks {
                    if action == "flag" {
                        clicks.flags += 1;
                    } else if p.revealed.contains(&index)
                        && p.board.as_ref().is_some_and(|b| b[index] > 0)
                    {
                        clicks.chords += 1;
                    } else {
                        clicks.reveals += 1;
                    }
                }
                if action == "flag" {
                    if !p.revealed.contains(&index) {
                        if p.flags.contains(&index) {
                            p.flags.retain(|&i| i != index);
                        } else if p.flags.len() < settings.mines {
                            p.flags.push(index);
                        }
                    }
                } else if !p.flags.contains(&index) {
                    if p.board.is_none() {
                        p.opening = Some(index);
                        let board = generate(settings, &[index]);
                        p.reveal(settings, &board, &[index]);
                        p.board = Some(board);
                        if self.started_at.is_none() {
                            self.started_at = Some(now());
                        }
                    } else {
                        let board = p.board.as_ref().unwrap();
                        let indices = if p.revealed.contains(&index) {
                            let ns = settings.neighbors(index);
                            if board[index] > 0
                                && ns.iter().filter(|i| p.flags.contains(i)).count()
                                    == board[index] as usize
                            {
                                ns
                            } else {
                                vec![]
                            }
                        } else {
                            vec![index]
                        };
                        // Temporarily take the board so mutable player state and immutable clues are separate.
                        let board = p.board.take().unwrap();
                        p.reveal(settings, &board, &indices);
                        p.board = Some(board);
                        if !self.solo && p.status == Status::Lost {
                            p.explode(settings, *p.revealed.last().unwrap());
                        }
                    }
                    self.finish();
                }
            }
            _ => return Err("Unknown action.".into()),
        }
        self.version += 1;
        Ok(())
    }
    /// Advance at most one AI move per room per scheduled turn. HTTP polling never drives it.
    pub fn advance_bot(&mut self, at: u64) -> bool {
        if self.solo
            || self.phase != Phase::Playing
            || at.saturating_sub(self.created_at) >= 86_400_000
            || at < self.available_at.unwrap_or(u64::MAX)
        {
            return false;
        }
        let Some(bot) = self
            .players
            .iter()
            .find(|p| p.bot && p.status == Status::Playing)
        else {
            return false;
        };
        if at < bot.bot_next_move_at.unwrap_or(0) {
            return false;
        }
        let settings = bot.settings.unwrap_or(self.settings);
        let mut visible = vec![None; settings.len()];
        if let Some(board) = bot.board.as_ref() {
            for &index in &bot.revealed {
                visible[index] = Some(board[index]);
            }
        }
        let id = bot.id.clone();
        let next = crate::bot::choose_move(settings, &visible, &bot.flags);
        let Some(next) = next else {
            return false;
        };
        let (action, index) = match next {
            crate::bot::BotMove::Reveal(i) => ("reveal", i),
            crate::bot::BotMove::Flag(i) => ("flag", i),
        };
        if self
            .act(&id, &json!({"type":action,"index":index}))
            .is_err()
        {
            return false;
        }
        if let Some(bot) = self.players.iter_mut().find(|p| p.id == id) {
            bot.bot_next_move_at = Some(at.saturating_add(700));
        }
        true
    }
    pub fn view(&self, id: &str) -> Result<Value, String> {
        let me = self
            .players
            .iter()
            .find(|p| p.id == id)
            .ok_or("Room session expired. Rejoin with the room code.")?;
        let settings = me.settings.unwrap_or(self.settings);
        let board = me.board.as_ref().or(self.board.as_ref());
        let revealed: BTreeSet<_> = me.revealed.iter().copied().collect();
        let cells: Vec<Option<i8>> = (0..settings.len())
            .map(|i| {
                board.and_then(|b| {
                    if revealed.contains(&i) || (self.phase == Phase::Finished && b[i] == -1) {
                        Some(b[i])
                    } else {
                        None
                    }
                })
            })
            .collect();
        let players: Vec<_> = self.players.iter().map(|p| {
            let settings = p.settings.unwrap_or(self.settings);
            let board = p.board.as_ref().or(self.board.as_ref());
            let cleared: Vec<_> = p.revealed.iter().copied().filter(|&i| board.is_none_or(|b| b[i] != -1)).collect();
            // Mirror only what the opponent has actually revealed. Never send their hidden layout.
            let visible: BTreeSet<_> = p.revealed.iter().copied().collect();
            let opponent_cells: Option<Vec<Option<i8>>> = if p.id != id { Some((0..settings.len()).map(|i| board.and_then(|b| visible.contains(&i).then_some(b[i]))).collect()) } else { None };
            let statistics = (self.phase == Phase::Finished).then(|| {
                let benchmark = board.map(|b| board_benchmark(settings, b, &p.revealed));
                let clicks = p.clicks.as_ref().map(ClickCounts::total);
                let efficiency = benchmark.zip(clicks).and_then(|((_, solved), clicks)| {
                    (clicks > 0).then(|| solved as f64 / clicks as f64 * 100.0)
                });
                let elapsed_ms = self.started_at.zip(self.finished_at).map(|(start, end)| end.saturating_sub(start)).unwrap_or(0);
                json!({"threeBV":benchmark.map(|b|b.0),"solvedThreeBV":benchmark.map(|b|b.1),"clicks":clicks,"clickBreakdown":p.clicks,"efficiency":efficiency,"elapsedMs":elapsed_ms,"reshuffled":p.hits>0})
            });
            json!({"statistics":statistics,"name":p.name,"you":p.id==id,"bot":p.bot,"ready":p.ready,"settings":settings,"openingChosen":p.opening.is_some(),"status":p.status,"cleared":cleared.len(),"flags":p.flags.len(),"clearedCells":cleared,"flaggedCells":if p.id != id {Some(&p.flags)} else {None},"cells":opponent_cells,"hits":p.hits,"explosion":p.explosion,"online":p.bot||now().saturating_sub(p.last_seen)<15000,"winner":self.winner.as_deref()==Some(p.id.as_str())})
        }).collect();
        Ok(
            json!({"serverNow":now(),"code":self.code,"settings":settings,"phase":self.phase,"solo":self.solo,"availableAt":self.available_at,"startedAt":self.started_at,"finishedAt":self.finished_at,"version":self.version,"winner":self.winner.as_ref().map(|winner|if winner==id{"you"}else{"opponent"}),"round":self.round,"host":self.players.first().is_some_and(|p|p.id==id),"me":{"name":me.name,"ready":me.ready,"opening":me.opening,"revealed":me.revealed,"flags":me.flags,"status":me.status,"lastSeen":me.last_seen,"hits":me.hits,"explosion":me.explosion},"players":players,"cells":cells}),
        )
    }
}
