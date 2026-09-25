//! Thumbnail toolbar de Windows: los 3 botoncitos (anterior / play-pausa /
//! siguiente) que aparecen en el preview de la ventana al pasar el ratón
//! por el icono de la app en la barra de tareas — igual que hace Tidal.
//!
//! Solo se compila y se usa en Windows (`cfg(windows)`); en el resto de
//! plataformas de escritorio este módulo no existe y no hace falta.
//!
//! NOTA: este código no se ha podido compilar/probar en este entorno (el
//! contenedor de desarrollo es Linux y no tiene toolchain de Windows).
//! Está escrito contra la API estable de `ITaskbarList3` de Win32 y la
//! versión 0.58 del crate `windows`, pero conviene compilarlo y probarlo
//! en una máquina Windows real antes de darlo por bueno — si `cargo build`
//! se queja de algún nombre exacto de tipo/constante, dímelo y lo ajusto.

#![cfg(windows)]

use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Controls::{DefSubclassProc, SetWindowSubclass};
use windows::Win32::UI::Shell::{
    ITaskbarList3, TaskbarList, THBF_ENABLED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    LoadImageW, HICON, IMAGE_ICON, LR_LOADFROMFILE, WM_COMMAND,
};

const BTN_PREVIOUS: u32 = 1001;
const BTN_PLAYPAUSE: u32 = 1002;
const BTN_NEXT: u32 = 1003;
const THBN_CLICKED: u32 = 0x1800;
const SUBCLASS_ID: usize = 0xA07A; // "AURA" a ojo, solo necesita ser único

struct ThumbbarInner {
    taskbar: ITaskbarList3,
    hwnd: HWND,
    icon_play: HICON,
    icon_pause: HICON,
}

// ITaskbarList3/HWND/HICON no son Send/Sync "de fábrica", pero todo el uso
// real pasa siempre por `run_on_main_thread`, así que en la práctica solo
// se tocan desde el hilo de UI (apartamento STA). Lo marcamos explícito.
unsafe impl Send for ThumbbarInner {}

pub struct ThumbbarState(Mutex<Option<ThumbbarInner>>);

impl Default for ThumbbarState {
    fn default() -> Self {
        ThumbbarState(Mutex::new(None))
    }
}

fn wide_null(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn load_icon(path: &std::path::Path) -> windows::core::Result<HICON> {
    let wide = wide_null(&path.to_string_lossy());
    unsafe {
        let handle = LoadImageW(
            None,
            PCWSTR(wide.as_ptr()),
            IMAGE_ICON,
            16,
            16,
            LR_LOADFROMFILE,
        )?;
        Ok(HICON(handle.0))
    }
}

fn tooltip_buf(text: &str) -> [u16; 260] {
    let mut buf = [0u16; 260];
    for (i, c) in text.encode_utf16().take(259).enumerate() {
        buf[i] = c;
    }
    buf
}

fn make_button(id: u32, icon: HICON, tooltip: &str) -> THUMBBUTTON {
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: tooltip_buf(tooltip),
        dwFlags: THBF_ENABLED,
    }
}

// Subclase de la ventana: intercepta el WM_COMMAND que Windows manda cuando
// se pulsa uno de los 3 botones del thumbbar, y reenvía el evento a JS.
unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    data: usize,
) -> LRESULT {
    if msg == WM_COMMAND {
        let notif_code = ((wparam.0 >> 16) & 0xffff) as u32;
        let btn_id = (wparam.0 & 0xffff) as u32;

        if notif_code == THBN_CLICKED {
            let app_handle = &*(data as *const AppHandle);
            let action = match btn_id {
                BTN_PREVIOUS => Some("previous"),
                BTN_PLAYPAUSE => Some("toggle-play"),
                BTN_NEXT => Some("next"),
                _ => None,
            };
            if let Some(action) = action {
                let _ = app_handle.emit("thumbbar-control", action);
            }
            return LRESULT(0);
        }
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// Se llama una vez, típicamente desde `.setup()`, con la ventana principal
/// ya creada. Añade los 3 botones y deja la ventana escuchando sus clics.
pub fn init(app: &AppHandle, window: &WebviewWindow) {
    let app_handle = app.clone();
    let window = window.clone();

    // Todo lo de abajo son llamadas a Win32/COM: tienen que ejecutarse en
    // el hilo de la ventana (STA), nunca desde el hilo de comandos de Tauri.
    let _ = window.clone().run_on_main_thread(move || {
        let hwnd = match window.hwnd() {
            Ok(h) => HWND(h.0),
            Err(e) => {
                log::error!("No se pudo obtener HWND para el thumbbar: {e}");
                return;
            }
        };

        let resource_dir = match app_handle.path().resolve(
            "icons/thumbbar",
            tauri::path::BaseDirectory::Resource,
        ) {
            Ok(p) => p,
            Err(e) => {
                log::error!("No se encontró la carpeta de iconos del thumbbar: {e}");
                return;
            }
        };

        let icon_previous = load_icon(&resource_dir.join("previous.ico"));
        let icon_next = load_icon(&resource_dir.join("next.ico"));
        let icon_play = load_icon(&resource_dir.join("play.ico"));
        let icon_pause = load_icon(&resource_dir.join("pause.ico"));

        let (icon_previous, icon_next, icon_play, icon_pause) =
            match (icon_previous, icon_next, icon_play, icon_pause) {
                (Ok(a), Ok(b), Ok(c), Ok(d)) => (a, b, c, d),
                _ => {
                    log::error!("No se pudieron cargar los iconos del thumbbar");
                    return;
                }
            };

        let taskbar: ITaskbarList3 =
            match unsafe { CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) } {
                Ok(t) => t,
                Err(e) => {
                    log::error!("No se pudo crear ITaskbarList3: {e}");
                    return;
                }
            };

        if let Err(e) = unsafe { taskbar.HrInit() } {
            log::error!("HrInit del taskbar falló: {e}");
            return;
        }

        let buttons = [
            make_button(BTN_PREVIOUS, icon_previous, "Anterior"),
            make_button(BTN_PLAYPAUSE, icon_play, "Reproducir"),
            make_button(BTN_NEXT, icon_next, "Siguiente"),
        ];

        if let Err(e) = unsafe { taskbar.ThumbBarAddButtons(hwnd, &buttons) } {
            log::error!("ThumbBarAddButtons falló: {e}");
            return;
        }

        // Guardamos el AppHandle en un Box con vida "estática" a propósito:
        // vive lo mismo que la ventana principal (toda la app).
        let app_handle_ptr = Box::into_raw(Box::new(app_handle.clone())) as usize;
        unsafe {
            let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, app_handle_ptr);
        }

        let state = app_handle.state::<ThumbbarState>();
        *state.0.lock().unwrap() = Some(ThumbbarInner {
            taskbar,
            hwnd,
            icon_play,
            icon_pause,
        });
    });
}

/// Llamado desde JS (comando de Tauri) cada vez que cambia isPlaying, para
/// que el botón central cambie entre icono de play e icono de pausa.
#[tauri::command]
pub fn thumbbar_set_playing(app: AppHandle, window: WebviewWindow, is_playing: bool) {
    let _ = window.run_on_main_thread(move || {
        let state = app.state::<ThumbbarState>();
        let guard = state.0.lock().unwrap();
        let Some(inner) = guard.as_ref() else { return };

        let icon = if is_playing {
            inner.icon_pause
        } else {
            inner.icon_play
        };
        let tooltip = if is_playing { "Pausar" } else { "Reproducir" };

        let button = make_button(BTN_PLAYPAUSE, icon, tooltip);
        unsafe {
            let _ = inner.taskbar.ThumbBarUpdateButtons(inner.hwnd, &[button]);
        }
    });
}
