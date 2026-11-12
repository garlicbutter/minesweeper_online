//! A basic test opponent. Decisions receive only visible clues and flags, never hidden mines.
use crate::game::{Settings, random_int};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BotMove {
    Reveal(usize),
    Flag(usize),
}

pub fn choose_move(settings: Settings, cells: &[Option<i8>], flags: &[usize]) -> Option<BotMove> {
    if cells.len() != settings.len() {
        return None;
    }
    let mut flagged = vec![false; cells.len()];
    for &index in flags {
        if index < flagged.len() {
            flagged[index] = true;
        }
    }
    // Prefer certain moves: satisfied clues expose safe cells; fully constrained clues mark mines.
    for (index, value) in cells.iter().enumerate() {
        let Some(clue) = value.filter(|&value| value >= 0) else {
            continue;
        };
        let neighbors = settings.neighbors(index);
        let marked = neighbors.iter().filter(|&&i| flagged[i]).count();
        let unknown: Vec<_> = neighbors
            .into_iter()
            .filter(|&i| cells[i].is_none() && !flagged[i])
            .collect();
        if unknown.is_empty() {
            continue;
        }
        let Some(remaining) = (clue as usize).checked_sub(marked) else {
            continue;
        };
        if remaining == 0 {
            return Some(BotMove::Reveal(unknown[0]));
        }
        if remaining == unknown.len() {
            return Some(BotMove::Flag(unknown[0]));
        }
    }
    let unknown: Vec<_> = cells
        .iter()
        .enumerate()
        .filter_map(|(i, cell)| (cell.is_none() && !flagged[i]).then_some(i))
        .collect();
    if unknown.is_empty() {
        return None;
    }
    let center = settings.height / 2 * settings.width + settings.width / 2;
    if cells.iter().all(Option::is_none) && !flagged[center] {
        return Some(BotMove::Reveal(center));
    }
    // Standard random boards can require guessing; the bot takes the same risk as a human.
    Some(BotMove::Reveal(unknown[random_int(unknown.len())]))
}
