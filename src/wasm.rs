//! Small JSON bridge: the browser calls the exact same Rust rules as the server.
use crate::game::Room;
use serde_json::{Value, json};

#[link(wasm_import_module = "env")]
unsafe extern "C" {
    fn report_panic(ptr: *const u8, len: u32);
}

#[unsafe(no_mangle)]
pub extern "C" fn allocate(len: u32) -> *mut u8 {
    Box::into_raw(vec![0u8; len as usize].into_boxed_slice()) as *mut u8
}
/// # Safety
/// `ptr` and `len` must identify a live allocation returned by this module.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn release(ptr: *mut u8, len: u32) {
    // SAFETY: JS returns the pointer and exact length previously returned by this module.
    unsafe {
        drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
            ptr,
            len as usize,
        )));
    }
}
fn dispatch(input: Value) -> Result<Value, String> {
    match input["op"].as_str() {
        Some("create") => {
            serde_json::to_value(Room::new(&input["input"])?).map_err(|e| e.to_string())
        }
        Some("act") | Some("view") => {
            let mut room: Room =
                serde_json::from_value(input["room"].clone()).map_err(|e| e.to_string())?;
            let id = input["id"].as_str().ok_or("Missing player session.")?;
            if input["op"] == "act" {
                room.act(id, &input["input"])?;
                serde_json::to_value(room).map_err(|e| e.to_string())
            } else {
                room.view(id)
            }
        }
        _ => Err("Unknown engine operation.".into()),
    }
}
/// # Safety
/// The input byte range must be allocated by this module and remain live for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn execute(ptr: *const u8, len: u32) -> u64 {
    std::panic::set_hook(Box::new(|info| {
        let message = info.to_string();
        // SAFETY: the JS logger reads the borrowed bytes synchronously.
        unsafe {
            report_panic(message.as_ptr(), message.len() as u32);
        }
    }));
    // SAFETY: JS allocated this byte range with allocate() and keeps it alive through the call.
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len as usize) };
    let result = serde_json::from_slice(bytes)
        .map_err(|e| e.to_string())
        .and_then(dispatch);
    let response = match result {
        Ok(value) => json!({ "ok": value }),
        Err(error) => json!({ "error": error }),
    };
    let output = serde_json::to_vec(&response)
        .expect("serialize engine response")
        .into_boxed_slice();
    let len = output.len() as u64;
    let ptr = Box::into_raw(output) as *mut u8 as u64;
    (len << 32) | ptr
}
