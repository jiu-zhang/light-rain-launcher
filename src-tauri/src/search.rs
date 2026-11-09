use std::sync::OnceLock;

use fuzzy_matcher::skim::SkimMatcherV2;
use fuzzy_matcher::FuzzyMatcher;

fn matcher() -> &'static SkimMatcherV2 {
    static MATCHER: OnceLock<SkimMatcherV2> = OnceLock::new();
    MATCHER.get_or_init(SkimMatcherV2::default)
}

/// 给候选项打分，返回值越小越靠前：
/// 0 名称完全一致 / 1 名称前缀 / 2 名称包含
/// 3 拼音完全一致 / 4 拼音前缀 / 5 拼音包含
/// 6 名称模糊 / 7 路径模糊
///
/// 第二个值是同档位内的细分分数，越大越靠前。
pub fn rank(name: &str, pinyin: &str, path: &str, query: &str) -> Option<(u8, i64)> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return None;
    }
    let name = name.to_lowercase();

    if name == q {
        return Some((0, 0));
    }
    if name.starts_with(&q) {
        return Some((1, 0));
    }
    if name.contains(&q) {
        return Some((2, 0));
    }
    if !pinyin.is_empty() {
        if pinyin == &q {
            return Some((3, 0));
        }
        if pinyin.starts_with(&q) {
            return Some((4, 0));
        }
        if pinyin.contains(&q) {
            return Some((5, 0));
        }
    }
    if let Some(score) = matcher().fuzzy_match(&name, &q) {
        return Some((6, score));
    }
    if let Some(score) = matcher().fuzzy_match(&path.to_lowercase(), &q) {
        return Some((7, score));
    }
    None
}
