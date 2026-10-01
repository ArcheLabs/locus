#![no_std]
#![allow(static_mut_refs)]
extern crate alloc;
#[cfg(not(target_env = "polkavm"))]
compile_error!("generated service must be built with the official PolkaVM target");

pub const JAMSCRIPT_RUNTIME_REFINE_INPUT_VERSION: u8 = 1;

use service_runtime_core::{
    BackendMetadataV1, ManagedStateCommitmentV1, RuntimeRefineInputV1, RuntimeRefineOutputV1, StateRoot,
    MANAGED_STATE_COMMITMENT_KEY_V1,
};
#[repr(C)]
pub struct RefineOutput { pub data: *const u8, pub size: usize }

extern "C" {
    fn minijam_payload(output: *mut u8, capacity: usize, output_size: *mut usize) -> u32;
    fn minijam_result_count() -> usize;
    fn minijam_result(index: usize, output: *mut u8, capacity: usize, output_size: *mut usize) -> u32;
    fn minijam_storage_read(key: *const u8, key_size: usize, output: *mut u8, capacity: usize, output_size: *mut usize) -> u32;
    fn minijam_service_storage_read(service_id: u32, key: *const u8, key_size: usize, output: *mut u8, capacity: usize, output_size: *mut usize) -> u32;
    fn minijam_storage_write(key: *const u8, key_size: usize, value: *const u8, value_size: usize) -> u32;
}

static mut INPUT: [u8; 1048576] = [0; 1048576];
static mut RESULT: [u8; 2097152] = [0; 2097152];
static mut OUTPUT: [u8; 2097152] = [0; 2097152];

mod generated_application_impl {
use service_runtime_core::{ScriptActionResultV1, ServiceApplication, ServiceKeyV1, StateAccessError};

const SERVICE_KEY: ServiceKeyV1 = ServiceKeyV1::new([44, 108, 192, 235, 139, 65, 159, 223, 78, 211, 41, 13, 51, 173, 184, 48, 98, 143, 0, 15, 84, 208, 48, 24, 19, 15, 204, 25, 189, 210, 73, 252]);
unsafe extern "C" {
    fn jamscript_scriptc_service_init();
    fn jamscript_scriptc_authorizeMatrixController_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_addController_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_revokeController_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_createAsset_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_createPool_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_addPoolLiquidity_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_removePoolLiquidity_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_swapExactIn_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_transfer_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_approve_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_transferFrom_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_mint_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
    fn jamscript_scriptc_burn_entry_v1(payload: *const u8, payload_len: usize, sender: *const u8, sender_len: usize, state: *const u8, state_len: usize, output: *mut *const u8, output_len: *mut usize);
}

fn application_key_allowed(key: &[u8]) -> bool {
    if key.len() < 3 || key[0] != service_runtime_core::APPLICATION_KEY_CLASS_V1 { return false; }
    let namespace_len = u16::from_le_bytes([key[1], key[2]]) as usize;
    let Some(namespace) = key.get(3..3usize.saturating_add(namespace_len)) else { return false; };
    namespace == &[108, 111, 99, 117, 115, 46, 97, 115, 115, 101, 116, 46, 118, 50] || namespace == &[108, 111, 99, 117, 115, 46, 97, 115, 115, 101, 116, 45, 99, 111, 117, 110, 116, 46, 118, 50] || namespace == &[108, 111, 99, 117, 115, 46, 97, 115, 115, 101, 116, 45, 105, 110, 100, 101, 120, 46, 118, 50] || namespace == &[108, 111, 99, 117, 115, 46, 98, 97, 108, 97, 110, 99, 101, 46, 118, 50] || namespace == &[108, 111, 99, 117, 115, 46, 97, 108, 108, 111, 119, 97, 110, 99, 101, 46, 118, 50] || namespace == &[108, 111, 99, 117, 115, 46, 99, 111, 110, 116, 114, 111, 108, 108, 101, 114, 45, 103, 114, 97, 110, 116, 46, 118, 49] || namespace == &[108, 111, 99, 117, 115, 46, 112, 111, 111, 108, 46, 118, 50] || namespace == &[108, 111, 99, 117, 115, 46, 112, 111, 111, 108, 45, 99, 111, 117, 110, 116, 46, 118, 50] || namespace == &[108, 111, 99, 117, 115, 46, 112, 111, 111, 108, 45, 105, 110, 100, 101, 120, 46, 118, 50] || namespace == &[108, 111, 99, 117, 115, 46, 108, 105, 113, 117, 105, 100, 105, 116, 121, 45, 115, 104, 97, 114, 101, 46, 118, 49] || namespace == &[108, 111, 99, 117, 115, 46, 108, 105, 113, 117, 105, 100, 105, 116, 121, 45, 112, 111, 115, 105, 116, 105, 111, 110, 45, 99, 111, 117, 110, 116, 46, 118, 49] || namespace == &[108, 111, 99, 117, 115, 46, 108, 105, 113, 117, 105, 100, 105, 116, 121, 45, 112, 111, 115, 105, 116, 105, 111, 110, 45, 105, 110, 100, 101, 120, 46, 118, 49]
}

fn apply_script_result(
    context: &mut service_runtime_core::ExecutionContext<'_>,
    result: ScriptActionResultV1,
) -> Result<(), StateAccessError> {
    match result {
        ScriptActionResultV1::Applied(diff) => {
            for change in diff.changes {
                if !application_key_allowed(&change.key) { return Err(StateAccessError::ReservedKey); }
                match change.value {
                    Some(value) => context.state().set(&change.key, &value)?,
                    None => context.state().delete(&change.key)?,
                }
            }
            Ok(())
        }
        ScriptActionResultV1::Abort(code) => Err(StateAccessError::ApplicationFailed(code)),
        ScriptActionResultV1::NeedState(key) => Err(StateAccessError::NeedState(key)),
        ScriptActionResultV1::Fatal(code) => Err(StateAccessError::ApplicationFailed(code)),
    }
}

fn encode_scriptc_ownership_context(
    owner: &jamscript_runtime_core::Ownership,
    controller: &jamscript_runtime_core::Ownership,
) -> Result<alloc::vec::Vec<u8>, StateAccessError> {
    let owner = owner.encode().map_err(|_| StateAccessError::Backend)?;
    let controller = controller.encode().map_err(|_| StateAccessError::Backend)?;
    if owner.len() > u16::MAX as usize || controller.len() > u16::MAX as usize {
        return Err(StateAccessError::Backend);
    }
    let total = 1usize
        .checked_add(2 + owner.len())
        .and_then(|value| value.checked_add(2 + controller.len()))
        .ok_or(StateAccessError::Backend)?;
    let mut encoded = alloc::vec::Vec::with_capacity(total);
    encoded.push(1);
    encoded.extend_from_slice(&(owner.len() as u16).to_le_bytes());
    encoded.extend_from_slice(&owner);
    encoded.extend_from_slice(&(controller.len() as u16).to_le_bytes());
    encoded.extend_from_slice(&controller);
    Ok(encoded)
}

fn execute_scriptc(
    context: &mut service_runtime_core::ExecutionContext<'_>,
    selector: [u8; 8],
    payload: &[u8],
    auth_context: &[u8],
) -> Result<(), StateAccessError> {
        context.begin_transaction()?;
    let business = (|| -> Result<(), StateAccessError> {
        let state_view = context.state_view()?.encode().map_err(|_| StateAccessError::Backend)?;
        let mut output = core::ptr::null();
        let mut output_len = 0usize;
        unsafe { jamscript_scriptc_service_init(); }
        match selector { [70, 100, 36, 122, 106, 195, 201, 135] => unsafe { jamscript_scriptc_authorizeMatrixController_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[49, 107, 133, 234, 186, 172, 168, 8] => unsafe { jamscript_scriptc_addController_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[131, 85, 38, 247, 219, 1, 245, 203] => unsafe { jamscript_scriptc_revokeController_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[73, 39, 0, 165, 103, 112, 222, 215] => unsafe { jamscript_scriptc_createAsset_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[135, 76, 116, 112, 112, 245, 170, 196] => unsafe { jamscript_scriptc_createPool_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[190, 237, 234, 12, 167, 47, 166, 219] => unsafe { jamscript_scriptc_addPoolLiquidity_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[43, 231, 2, 34, 64, 176, 237, 98] => unsafe { jamscript_scriptc_removePoolLiquidity_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[233, 102, 198, 166, 161, 132, 126, 9] => unsafe { jamscript_scriptc_swapExactIn_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[248, 94, 61, 230, 178, 87, 60, 158] => unsafe { jamscript_scriptc_transfer_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[131, 210, 47, 194, 16, 203, 203, 88] => unsafe { jamscript_scriptc_approve_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[78, 59, 135, 12, 160, 245, 110, 55] => unsafe { jamscript_scriptc_transferFrom_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[143, 61, 58, 14, 231, 119, 71, 43] => unsafe { jamscript_scriptc_mint_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) },
[36, 212, 112, 60, 146, 111, 247, 79] => unsafe { jamscript_scriptc_burn_entry_v1(payload.as_ptr(), payload.len(), auth_context.as_ptr(), auth_context.len(), state_view.as_ptr(), state_view.len(), &mut output, &mut output_len) }, _ => return Err(StateAccessError::Rejected(jamscript_runtime_core::RuntimeError::UnknownAction.code())), }
        if output.is_null() && output_len != 0 { return Err(StateAccessError::ApplicationFailed(0x8000_0002)); }
        if output_len > service_runtime_core::MAX_SCRIPT_ACTION_RESULT_BYTES { return Err(StateAccessError::ApplicationFailed(0x8000_0002)); }
        let bytes = if output_len == 0 { &[] } else { unsafe { core::slice::from_raw_parts(output, output_len) } };
        let result = ScriptActionResultV1::decode(bytes)
            .map_err(|_| StateAccessError::ApplicationFailed(0x8000_0002))?;
        apply_script_result(context, result)
    })();
    match business {
        Ok(()) => context.commit_transaction(),
        Err(error) => { context.rollback_transaction()?; Err(error) }
    }
}

pub struct GeneratedApplication;
impl ServiceApplication for GeneratedApplication {
    type Error = StateAccessError;
    fn execute(
        &self,
        context: &mut service_runtime_core::ExecutionContext<'_>,
        raw_action: &[u8],
    ) -> Result<(), Self::Error> {
        
        let signed = jamscript_runtime_core::decode_signed_action_v2(raw_action)
            .map_err(|error| StateAccessError::Rejected(error.code()))?;
        match signed.action_selector { [70, 100, 36, 122, 106, 195, 201, 135] => (),
[49, 107, 133, 234, 186, 172, 168, 8] => (),
[131, 85, 38, 247, 219, 1, 245, 203] => (),
[73, 39, 0, 165, 103, 112, 222, 215] => (),
[135, 76, 116, 112, 112, 245, 170, 196] => (),
[190, 237, 234, 12, 167, 47, 166, 219] => (),
[43, 231, 2, 34, 64, 176, 237, 98] => (),
[233, 102, 198, 166, 161, 132, 126, 9] => (),
[248, 94, 61, 230, 178, 87, 60, 158] => (),
[131, 210, 47, 194, 16, 203, 203, 88] => (),
[78, 59, 135, 12, 160, 245, 110, 55] => (),
[143, 61, 58, 14, 231, 119, 71, 43] => (),
[36, 212, 112, 60, 146, 111, 247, 79] => (), _ => return Err(StateAccessError::Rejected(jamscript_runtime_core::RuntimeError::UnknownAction.code())), }
        let selected_selector = signed.action_selector;
        if signed.act_as.is_some() {
            return Err(StateAccessError::Rejected(
                jamscript_runtime_core::RuntimeError::ActAsUnsupported.code(),
            ));
        }
        let nonce_key = jamscript_runtime_core::ownership_nonce_key(&signed.controller)
            .map_err(|_| StateAccessError::Backend)?;
        let nonce_bytes = context.state().get(&nonce_key)?.unwrap_or_default();
        let expected_nonce = match nonce_bytes.as_slice() {
            [] => 0u64,
            bytes if bytes.len() == 8 => u64::from_le_bytes(bytes.try_into().map_err(|_| StateAccessError::Backend)?),
            _ => return Err(StateAccessError::Backend),
        };
        let verified = jamscript_runtime_core::verify_signed_action_v2(
            signed, context.network_domain(), SERVICE_KEY, selected_selector,
            Some(expected_nonce),
        ).map_err(|error| StateAccessError::Rejected(error.code()))?;
        context.set_ownership(verified.owner.clone(), verified.controller.clone());
        context.constrain_valid_until(verified.valid_until);
        let next_nonce = expected_nonce.checked_add(1).ok_or(StateAccessError::Backend)?;
        context.state().set(&nonce_key, &next_nonce.to_le_bytes())?;
        let auth_context = encode_scriptc_ownership_context(&verified.owner, &verified.controller)?;
        execute_scriptc(context, selected_selector, verified.payload, &auth_context)

    }
}
}
pub use generated_application_impl::GeneratedApplication;


fn run_refine() -> Result<RuntimeRefineOutputV1, service_runtime_guest::GuestError> {
    service_runtime_guest::guest_support::reset_runtime();
    
    let mut input_size = 0usize;
    let status = unsafe { minijam_payload(INPUT.as_mut_ptr(), 1048576, &mut input_size) };
    if status != 0 { return Err(service_runtime_guest::GuestError::InvalidInput); }
    
    let input = unsafe { core::slice::from_raw_parts(INPUT.as_ptr(), input_size) };
    let runtime_input = match RuntimeRefineInputV1::decode(input) {
        Ok(value) => value,
        Err(_) => return Err(service_runtime_guest::GuestError::InvalidInput),
    };
    
    let output = match service_runtime_guest::refine_owned(&GeneratedApplication, runtime_input) {
        Ok(value) => value,
        Err(error) => return Err(error),
    };
    
    Ok(output)
}

fn run_plan() -> Result<(), service_runtime_guest::GuestError> {
    service_runtime_guest::guest_support::reset_runtime();
    let mut input_size = 0usize;
    let status = unsafe { minijam_payload(INPUT.as_mut_ptr(), 1048576, &mut input_size) };
    if status != 0 { return Err(service_runtime_guest::GuestError::InvalidInput); }
    let input = unsafe { core::slice::from_raw_parts(INPUT.as_ptr(), input_size) };
    let runtime_input = match RuntimeRefineInputV1::decode(input) {
        Ok(value) => value,
        Err(_) => return Err(service_runtime_guest::GuestError::InvalidInput),
    };
    service_runtime_guest::plan_owned_with_external(&GeneratedApplication, runtime_input)
}

fn output_for(planning: bool) -> RefineOutput {
    if planning {
        return match run_plan() {
            Ok(()) => planner_done_output(),
            Err(service_runtime_guest::GuestError::NeedState(key)) => {
                let encoded = match service_runtime_core::encode_planner_need_state(&key) {
                    Ok(value) => value,
                    Err(_) => return error_output(2),
                };
                if encoded.len() > 2097152 { return error_output(14); }
                unsafe { OUTPUT[..encoded.len()].copy_from_slice(&encoded); }
                RefineOutput { data: unsafe { OUTPUT.as_ptr() }, size: encoded.len() }
            }
            Err(service_runtime_guest::GuestError::NeedExternalState { service_id, key }) => {
                let encoded = match service_runtime_core::encode_planner_need_external_state(service_id, &key) {
                    Ok(value) => value,
                    Err(_) => return error_output(2),
                };
                if encoded.len() > 2097152 { return error_output(14); }
                unsafe { OUTPUT[..encoded.len()].copy_from_slice(&encoded); }
                RefineOutput { data: unsafe { OUTPUT.as_ptr() }, size: encoded.len() }
            }
            Err(service_runtime_guest::GuestError::InvalidInput) => error_output(1),
            Err(service_runtime_guest::GuestError::Environment) => error_output(2),
            Err(service_runtime_guest::GuestError::State) => error_output(2),
            Err(service_runtime_guest::GuestError::Application) => error_output(3),
        };
    }
    let output = match run_refine() {
        Ok(output) => output,
        Err(service_runtime_guest::GuestError::NeedState(key)) if planning => {
            let encoded = match service_runtime_core::encode_planner_need_state(&key) {
                Ok(value) => value,
                Err(_) => return error_output(2),
            };
            if encoded.len() > 2097152 { return error_output(14); }
            unsafe { OUTPUT[..encoded.len()].copy_from_slice(&encoded); }
            return RefineOutput { data: unsafe { OUTPUT.as_ptr() }, size: encoded.len() };
        }
        Err(service_runtime_guest::GuestError::InvalidInput) => return error_output(1),
        Err(service_runtime_guest::GuestError::Environment) => return error_output(2),
        Err(service_runtime_guest::GuestError::State) => return error_output(2),
        Err(service_runtime_guest::GuestError::Application) => return error_output(3),
        Err(service_runtime_guest::GuestError::NeedState(_)) => return error_output(2),
        Err(service_runtime_guest::GuestError::NeedExternalState { .. }) => return error_output(2),
    };
    if output.receipts.len() == 1 {
        if let Some(error_code) = output.receipts[0]
            .error_code
            .filter(|code| code & 0x8000_0000 != 0)
        {
            service_runtime_guest::guest_support::diagnostic_stage(b"jamscript:native-error-output");
            return error_output(error_code);
        }
    }
    
    let encoded = match output.encode() {
        Ok(value) => value,
        Err(_) => return error_output(2),
    };
    if encoded.len() > 2097152 { return error_output(14); }
    unsafe { OUTPUT[..encoded.len()].copy_from_slice(&encoded); }
    
    RefineOutput { data: unsafe { OUTPUT.as_ptr() }, size: encoded.len() }
}

#[no_mangle]
pub extern "C" fn minijam_refine() -> RefineOutput { output_for(false) }

#[no_mangle]
pub extern "C" fn jamscript_plan_v1() -> RefineOutput { output_for(true) }

#[no_mangle]
pub extern "C" fn jamscript_backend_metadata_v1() -> RefineOutput {
    let metadata = BackendMetadataV1 {
        service_key: service_runtime_core::ServiceKeyV1::new([44, 108, 192, 235, 139, 65, 159, 223, 78, 211, 41, 13, 51, 173, 184, 48, 98, 143, 0, 15, 84, 208, 48, 24, 19, 15, 204, 25, 189, 210, 73, 252]),
        abi_version: 1,
        planner_version: service_runtime_core::BACKEND_PLANNER_VERSION,
        managed_state_version: service_runtime_core::BACKEND_MANAGED_STATE_VERSION,
    };
    let encoded = metadata.encode();
    unsafe { OUTPUT[..encoded.len()].copy_from_slice(&encoded); }
    RefineOutput { data: unsafe { OUTPUT.as_ptr() }, size: encoded.len() }
}

#[no_mangle]
pub extern "C" fn minijam_accumulate() {
    // The host runtime places the accumulation init input in A memory and initializes
    // a0/a1 to its pointer and length, while the SDK export still uses
    // input_regs=0 because this is invocation-context transport.
    let init_pointer: usize;
    let init_size: usize;
    unsafe {
        core::arch::asm!(
            "mv t0, a0",
            "mv t1, a1",
            // Keep the two invocation-context registers distinct. `out(reg)`
            // permits LLVM to assign both outputs to the same register, which
            // loses the input length in optimized non-diagnostic guests.
            lateout("t0") init_pointer,
            lateout("t1") init_size,
            options(nomem, nostack, preserves_flags),
        );
    }
    let init_input = unsafe { core::slice::from_raw_parts(init_pointer as *const u8, init_size) };
    let (authoritative_tick, _sid, _items_count) =
        match decode_accumulate_init_input(init_input) { Ok(value) => value, Err(_) => return };
    let mut current = read_current_commitment().unwrap_or(service_runtime_core::EMPTY_STATE_ROOT_V1);
    let mut advanced = false;
    let count = unsafe { minijam_result_count() };
    for index in 0..count {
        let mut size = 0usize;
        if unsafe { minijam_result(index, RESULT.as_mut_ptr(), 2097152, &mut size) } != 0 { continue; }
        let refined = unsafe { core::slice::from_raw_parts(RESULT.as_ptr(), size) };
        let Ok(header) = RuntimeRefineOutputV1::decode_transition_header(refined) else { continue; };
        if header.parent_root != current { continue; }
        if header.transition_valid_until.is_some_and(|valid_until| authoritative_tick > valid_until) { continue; }
        let mut dependencies_valid = true;
        for dependency in &header.external_dependencies {
            let Ok(canonical) = read_service_commitment(dependency.service_id) else { dependencies_valid = false; break; };
            if canonical != dependency.state_root { dependencies_valid = false; break; }
        }
        if !dependencies_valid { continue; }
        current = header.new_root;
        advanced = true;
    }
    if advanced {
        let commitment = ManagedStateCommitmentV1::new(current).encode();
        let key = MANAGED_STATE_COMMITMENT_KEY_V1;
        let _ = unsafe {
            minijam_storage_write(key.as_ptr(), key.len(), commitment.as_ptr(), commitment.len())
        };
    }
}

fn read_current_commitment() -> Result<StateRoot, ()> {
    let key = MANAGED_STATE_COMMITMENT_KEY_V1;
    let mut bytes = [0u8; 34];
    let mut size = 0usize;
    let status = unsafe {
        minijam_storage_read(key.as_ptr(), key.len(), bytes.as_mut_ptr(), bytes.len(), &mut size)
    };
    match status {
        1 => Ok(service_runtime_core::EMPTY_STATE_ROOT_V1),
        0 if size == bytes.len() => ManagedStateCommitmentV1::decode(&bytes)
            .map(|commitment| commitment.root)
            .map_err(|_| ()),
        _ => Err(()),
    }
}

fn read_service_commitment(service_id: u32) -> Result<StateRoot, ()> {
    let key = MANAGED_STATE_COMMITMENT_KEY_V1;
    let mut bytes = [0u8; 34];
    let mut size = 0usize;
    let status = unsafe {
        minijam_service_storage_read(service_id, key.as_ptr(), key.len(), bytes.as_mut_ptr(), bytes.len(), &mut size)
    };
    match status {
        0 if size == bytes.len() => ManagedStateCommitmentV1::decode(&bytes)
            .map(|commitment| commitment.root)
            .map_err(|_| ()),
        _ => Err(()),
    }
}

fn error_output(code: u32) -> RefineOutput { unsafe { OUTPUT[..4].copy_from_slice(&code.to_le_bytes()); RefineOutput { data: OUTPUT.as_ptr(), size: 4 } } }
fn planner_done_output() -> RefineOutput { unsafe { OUTPUT[0] = 0; RefineOutput { data: OUTPUT.as_ptr(), size: 1 } } }
fn read_fnencode(input: &[u8], offset: &mut usize) -> Result<u64, ()> {
    let first = *input.get(*offset).ok_or(())?;
    *offset += 1;
    if first < 0x80 { return Ok(first as u64); }
    let mut length = 0usize;
    while length < 8 && (first & (0x80u8 >> length)) != 0 { length += 1; }
    if length == 0 || length > 7 || input.len().saturating_sub(*offset) < length { return Err(()); }
    let mut low = 0u64;
    for index in 0..length { low |= (*input.get(*offset + index).ok_or(())? as u64) << (8 * index); }
    *offset += length;
    Ok(((first as u64 & (0x7fu64 >> length)) << (8 * length)) | low)
}

fn decode_accumulate_init_input(input: &[u8]) -> Result<(u64, u64, u64), ()> {
    let mut offset = 0usize;
    let tick = read_fnencode(input, &mut offset)?;
    let sid = read_fnencode(input, &mut offset)?;
    let items_count = read_fnencode(input, &mut offset)?;
    if offset != input.len() { return Err(()); }
    Ok((tick, sid, items_count))
}

