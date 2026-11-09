fn main() {
    let appdata = std::env::var("APPDATA").expect("no APPDATA");
    let path = format!("{appdata}\\com.lightrain.launcher\\light-rain.db");
    let conn = rusqlite::Connection::open(&path).expect("open db");
    let total: i64 = conn
        .query_row("SELECT COUNT(*) FROM files", [], |r| r.get(0))
        .unwrap_or(-1);
    let pinned: i64 = conn
        .query_row("SELECT COUNT(*) FROM files WHERE pinned = 1", [], |r| r.get(0))
        .unwrap_or(-1);
    println!("total={total} pinned={pinned}");
    let mut stmt = conn
        .prepare("SELECT name, source, open_count, pinyin FROM files ORDER BY last_opened DESC LIMIT 12")
        .expect("prepare");
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
            ))
        })
        .expect("query");
    for row in rows.flatten() {
        println!("  {} | {} | open={} | py={}", row.0, row.1, row.2, row.3);
    }
}
