fn main() {
    #[cfg(target_os = "macos")]
    link_compiler_rt();
    tauri_build::build()
}

// whisper-rs compiles ggml-metal.m which uses @available() checks that emit
// ___isPlatformVersionAtLeast. That symbol lives in Apple's compiler runtime
// (libclang_rt.osx.a). Rust links with -nodefaultlibs so it is never pulled in
// automatically; we have to add it explicitly.
//
// We use `xcrun clang -print-resource-dir` instead of a hardcoded path so this
// works on any Mac regardless of Xcode / Command Line Tools version.
#[cfg(target_os = "macos")]
fn link_compiler_rt() {
    use std::process::Command;

    let output = Command::new("xcrun")
        .args(["clang", "-print-resource-dir"])
        .output()
        .expect(
            "failed to run `xcrun clang -print-resource-dir`; \
             ensure Xcode Command Line Tools are installed (`xcode-select --install`)",
        );

    assert!(
        output.status.success(),
        "xcrun clang -print-resource-dir failed with status {}",
        output.status
    );

    let resource_dir = String::from_utf8(output.stdout)
        .expect("xcrun output is not valid UTF-8")
        .trim()
        .to_string();

    let rt_path = format!("{resource_dir}/lib/darwin/libclang_rt.osx.a");

    assert!(
        std::path::Path::new(&rt_path).exists(),
        "libclang_rt.osx.a not found at {rt_path}; \
         please ensure Xcode or Command Line Tools are up to date"
    );

    println!("cargo:rustc-link-arg={rt_path}");
}
