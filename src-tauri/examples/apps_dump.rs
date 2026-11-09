fn main() {
    let list = light_rain_launcher_lib::apps::scan();
    println!("apps = {}", list.len());
    for a in list.iter().take(25) {
        println!("  {:28} py={:22} {}", a.name, a.pinyin, a.path);
    }
}
