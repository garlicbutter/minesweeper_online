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
fn random_int(n: usize) -> usize {
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
pub struct Player {
    pub id: String,
    pub name: String,
    pub ready: bool,
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
            opening: None,
            revealed: vec![],
            flags: vec![],
            status: Status::Playing,
            last_seen: now(),
        }
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
        Ok(Self {
            code: (0..6)
                .map(|_| alphabet[random_int(alphabet.len())] as char)
                .collect(),
            settings: Settings::from_input(input)?,
            players: vec![Player::new(input["name"].as_str().unwrap_or("Player"))],
            phase: Phase::Waiting,
            solo: input["solo"].as_bool().unwrap_or(false),
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
        if self.solo || self.phase != Phase::Waiting || self.players.len() >= 2 {
            return Err("This room is full or the match has started.".into());
        }
        let p = Player::new(name);
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
        self.players[pi].last_seen = now();
        let action = input["type"].as_str().unwrap_or("");
        if action == "ping" {
            return Ok(());
        }
        match action {
            "ready" => {
                if self.phase != Phase::Waiting {
                    return Err("The round has already started.".into());
                }
                self.players[pi].ready = !self.players[pi].ready;
                if self.players.len() == if self.solo { 1 } else { 2 }
                    && self.players.iter().all(|p| p.ready)
                {
                    self.available_at = Some(now() + if self.solo { 0 } else { 3000 });
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
                    p.ready = false;
                    p.opening = None;
                    p.revealed.clear();
                    p.flags.clear();
                    p.status = Status::Playing;
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
                let index = input["index"]
                    .as_u64()
                    .and_then(|v| usize::try_from(v).ok())
                    .filter(|&i| i < self.settings.len())
                    .ok_or("Invalid cell.")?;
                let p = &mut self.players[pi];
                if action == "flag" {
                    if !p.revealed.contains(&index) && p.opening != Some(index) {
                        if p.flags.contains(&index) {
                            p.flags.retain(|&i| i != index);
                        } else if p.flags.len() < self.settings.mines {
                            p.flags.push(index);
                        }
                    }
                } else if !p.flags.contains(&index) {
                    if let Some(board) = self.board.as_ref() {
                        let indices = if p.revealed.contains(&index) {
                            let ns = self.settings.neighbors(index);
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
                        p.reveal(self.settings, board, &indices);
                    } else {
                        if p.opening.is_some() {
                            return Ok(());
                        }
                        p.opening = Some(index);
                        if self.players.iter().all(|p| p.opening.is_some()) {
                            let openings: Vec<_> =
                                self.players.iter().filter_map(|p| p.opening).collect();
                            let board = generate(self.settings, &openings);
                            self.started_at = Some(now());
                            for p in &mut self.players {
                                p.reveal(self.settings, &board, &[p.opening.unwrap()]);
                            }
                            self.board = Some(board);
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
    pub fn view(&self, id: &str) -> Result<Value, String> {
        let me = self
            .players
            .iter()
            .find(|p| p.id == id)
            .ok_or("Room session expired. Rejoin with the room code.")?;
        let mut revealed = vec![false; self.settings.len()];
        for &i in &me.revealed {
            revealed[i] = true;
        }
        let cells: Vec<Option<i8>> = (0..self.settings.len())
            .map(|i| {
                self.board.as_ref().and_then(|b| {
                    if revealed[i] || (self.phase == Phase::Finished && b[i] == -1) {
                        Some(b[i])
                    } else {
                        None
                    }
                })
            })
            .collect();
        let players: Vec<_> = self.players.iter().map(|p| {
            let cleared: Vec<_> = p.revealed.iter().copied().filter(|&i| self.board.as_ref().is_none_or(|b| b[i] != -1)).collect();
            json!({ "name": p.name, "you": p.id == id, "ready": p.ready, "openingChosen": p.opening.is_some(), "status": p.status, "cleared": cleared.len(), "flags": p.flags.len(), "clearedCells": cleared, "online": now().saturating_sub(p.last_seen) < 15000, "winner": self.winner.as_deref() == Some(p.id.as_str()) })
        }).collect();
        Ok(
            json!({ "code": self.code, "settings": self.settings, "phase": self.phase, "solo": self.solo, "availableAt": self.available_at, "startedAt": self.started_at, "finishedAt": self.finished_at, "version": self.version, "winner": self.winner.as_ref().map(|winner| if winner == id { "you" } else { "opponent" }), "round": self.round, "host": self.players.first().is_some_and(|p| p.id == id), "me": { "name": me.name, "ready": me.ready, "opening": me.opening, "revealed": me.revealed, "flags": me.flags, "status": me.status, "lastSeen": me.last_seen }, "players": players, "cells": cells }),
        )
    }
}
