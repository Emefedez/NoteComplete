mod mcp;
use noteful_core::Package;
use std::{
    io::{self, Read, Write},
    process::ExitCode,
};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os().skip(1);
    let cmd = args
        .next()
        .ok_or("Usage: noteful inspect|verify|render|export <file|->, or noteful mcp")?;
    if cmd == "mcp" {
        return mcp::serve();
    }
    let source = args.next().ok_or("Missing input file (or - for stdin)")?;
    if args.next().is_some() {
        return Err("Too many arguments".into());
    }
    if cmd != "inspect" && cmd != "verify" && cmd != "render" && cmd != "export" {
        return Err("Expected inspect, verify, render or export".into());
    }
    let mut input: Box<dyn Read> = if source == "-" {
        Box::new(io::stdin())
    } else {
        Box::new(std::fs::File::open(source)?)
    };
    let mut data = Vec::new();
    let mut chunk = vec![0; 1024 * 1024];
    loop {
        let n = input.read(&mut chunk)?;
        if n == 0 {
            break;
        }
        data.try_reserve(n)?;
        data.extend_from_slice(&chunk[..n]);
    }
    if cmd == "export" {
        let editor = noteful_core::Editor::open_project(std::str::from_utf8(&data)?)?;
        io::stdout().lock().write_all(&editor.export_noteful()?)?;
        return Ok(());
    }
    if cmd == "render" {
        let editor = noteful_core::Editor::open(&data)?;
        let pages = (0..editor.scene.pages.len())
            .map(|i| editor.view(i))
            .collect::<Result<Vec<_>, _>>()?;
        serde_json::to_writer(
            io::stdout().lock(),
            &serde_json::json!({"title":editor.scene.title,"pages":pages}),
        )?;
        return Ok(());
    }
    let package = Package::parse(&data)?;
    if cmd == "verify" {
        if package.rebuild()? != data {
            return Err("Round-trip mismatch".into());
        }
        println!(
            "Verified {} bytes, {} blocks; byte-exact round-trip",
            data.len(),
            package.blocks.len()
        );
    } else {
        let mut stdout = io::BufWriter::new(io::stdout().lock());
        serde_json::to_writer(&mut stdout, &package.to_json())?;
        stdout.write_all(b"\n")?;
    }
    Ok(())
}
fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("Error: {e}");
            ExitCode::FAILURE
        }
    }
}
