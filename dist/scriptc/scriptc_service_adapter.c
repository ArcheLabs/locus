#include <stddef.h>
#include <stdint.h>

extern void jamscript_scriptc_service_init_scriptc(void);
extern int32_t jamscript_scriptc_service_set_callback(
    const char *name,
    void (*function)(void),
    void *context
);
extern uint32_t jamscript_verify_ed25519(
    const uint8_t *public_key,
    size_t public_key_len,
    const uint8_t *message,
    size_t message_len,
    const uint8_t *signature,
    size_t signature_len
);

static uint32_t jamscript_scriptc_ed25519_verifier_callback(
    void *context,
    const uint8_t *public_key,
    size_t public_key_len,
    const uint8_t *message,
    size_t message_len,
    const uint8_t *signature,
    size_t signature_len
) {
    (void)context;
    return jamscript_verify_ed25519(
        public_key, public_key_len, message, message_len, signature, signature_len
    );
}

void jamscript_scriptc_service_init(void) {
    jamscript_scriptc_service_init_scriptc();
    if (jamscript_scriptc_service_set_callback(
            "jamscript_verify_ed25519",
            (void (*)(void))jamscript_scriptc_ed25519_verifier_callback,
            NULL
        ) != 0) {
        __builtin_trap();
    }
}
