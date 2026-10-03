#include <stdint.h>
#include <stddef.h>
#include "jam/service-descriptor-v2.h"

extern void jamscript_scriptc_service_init(void);
extern void jamscript_scriptc_authorizeMatrixController_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_addController_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_revokeController_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_createAsset_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_createPool_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_addPoolLiquidity_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_removePoolLiquidity_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_swapExactIn_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_transfer_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_approve_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_transferFrom_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_mint_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);
extern void jamscript_scriptc_burn_entry_v1(const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t *, size_t, const uint8_t **, size_t *);

static const uint8_t jamscript_namespace_0[] = {108, 111, 99, 117, 115, 46, 97, 115, 115, 101, 116, 46, 118, 50};
static const uint8_t jamscript_namespace_1[] = {108, 111, 99, 117, 115, 46, 97, 115, 115, 101, 116, 45, 99, 111, 117, 110, 116, 46, 118, 50};
static const uint8_t jamscript_namespace_2[] = {108, 111, 99, 117, 115, 46, 97, 115, 115, 101, 116, 45, 105, 110, 100, 101, 120, 46, 118, 50};
static const uint8_t jamscript_namespace_3[] = {108, 111, 99, 117, 115, 46, 98, 97, 108, 97, 110, 99, 101, 46, 118, 50};
static const uint8_t jamscript_namespace_4[] = {108, 111, 99, 117, 115, 46, 97, 108, 108, 111, 119, 97, 110, 99, 101, 46, 118, 50};
static const uint8_t jamscript_namespace_5[] = {108, 111, 99, 117, 115, 46, 99, 111, 110, 116, 114, 111, 108, 108, 101, 114, 45, 103, 114, 97, 110, 116, 46, 118, 49};
static const uint8_t jamscript_namespace_6[] = {108, 111, 99, 117, 115, 46, 112, 111, 111, 108, 46, 118, 50};
static const uint8_t jamscript_namespace_7[] = {108, 111, 99, 117, 115, 46, 112, 111, 111, 108, 45, 99, 111, 117, 110, 116, 46, 118, 50};
static const uint8_t jamscript_namespace_8[] = {108, 111, 99, 117, 115, 46, 112, 111, 111, 108, 45, 105, 110, 100, 101, 120, 46, 118, 50};
static const uint8_t jamscript_namespace_9[] = {108, 111, 99, 117, 115, 46, 108, 105, 113, 117, 105, 100, 105, 116, 121, 45, 115, 104, 97, 114, 101, 46, 118, 49};
static const uint8_t jamscript_namespace_10[] = {108, 111, 99, 117, 115, 46, 108, 105, 113, 117, 105, 100, 105, 116, 121, 45, 112, 111, 115, 105, 116, 105, 111, 110, 45, 99, 111, 117, 110, 116, 46, 118, 49};
static const uint8_t jamscript_namespace_11[] = {108, 111, 99, 117, 115, 46, 108, 105, 113, 117, 105, 100, 105, 116, 121, 45, 112, 111, 115, 105, 116, 105, 111, 110, 45, 105, 110, 100, 101, 120, 46, 118, 49};

static const JamScriptNamespaceDescriptorV1 jamscript_namespaces[] = {
    { jamscript_namespace_0, 14 },
    { jamscript_namespace_1, 20 },
    { jamscript_namespace_2, 20 },
    { jamscript_namespace_3, 16 },
    { jamscript_namespace_4, 18 },
    { jamscript_namespace_5, 25 },
    { jamscript_namespace_6, 13 },
    { jamscript_namespace_7, 19 },
    { jamscript_namespace_8, 19 },
    { jamscript_namespace_9, 24 },
    { jamscript_namespace_10, 33 },
    { jamscript_namespace_11, 33 },
};

static const JamScriptActionDescriptorV1 jamscript_actions[] = {
    { { 0x46, 0x64, 0x24, 0x7a, 0x6a, 0xc3, 0xc9, 0x87 }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_authorizeMatrixController_entry_v1 },
    { { 0x31, 0x6b, 0x85, 0xea, 0xba, 0xac, 0xa8, 0x08 }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_addController_entry_v1 },
    { { 0x83, 0x55, 0x26, 0xf7, 0xdb, 0x01, 0xf5, 0xcb }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_revokeController_entry_v1 },
    { { 0x49, 0x27, 0x00, 0xa5, 0x67, 0x70, 0xde, 0xd7 }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_createAsset_entry_v1 },
    { { 0x87, 0x4c, 0x74, 0x70, 0x70, 0xf5, 0xaa, 0xc4 }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_createPool_entry_v1 },
    { { 0xbe, 0xed, 0xea, 0x0c, 0xa7, 0x2f, 0xa6, 0xdb }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_addPoolLiquidity_entry_v1 },
    { { 0x2b, 0xe7, 0x02, 0x22, 0x40, 0xb0, 0xed, 0x62 }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_removePoolLiquidity_entry_v1 },
    { { 0xe9, 0x66, 0xc6, 0xa6, 0xa1, 0x84, 0x7e, 0x09 }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_swapExactIn_entry_v1 },
    { { 0xf8, 0x5e, 0x3d, 0xe6, 0xb2, 0x57, 0x3c, 0x9e }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_transfer_entry_v1 },
    { { 0x83, 0xd2, 0x2f, 0xc2, 0x10, 0xcb, 0xcb, 0x58 }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_approve_entry_v1 },
    { { 0x4e, 0x3b, 0x87, 0x0c, 0xa0, 0xf5, 0x6e, 0x37 }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_transferFrom_entry_v1 },
    { { 0x8f, 0x3d, 0x3a, 0x0e, 0xe7, 0x77, 0x47, 0x2b }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_mint_entry_v1 },
    { { 0x24, 0xd4, 0x70, 0x3c, 0x92, 0x6f, 0xf7, 0x4f }, JAMSCRIPT_AUTH_OWNERSHIP_V1, { 0 }, jamscript_scriptc_burn_entry_v1 },
};

const JamScriptServiceDescriptorV2 jamscript_service_descriptor_v2 = {
    JAMSCRIPT_SERVICE_DESCRIPTOR_V2,
    13,
    jamscript_actions,
    12,
    jamscript_namespaces,
    { 44, 108, 192, 235, 139, 65, 159, 223, 78, 211, 41, 13, 51, 173, 184, 48, 98, 143, 0, 15, 84, 208, 48, 24, 19, 15, 204, 25, 189, 210, 73, 252 },
    { 78, 182, 195, 231, 203, 186, 196, 173, 50, 195, 65, 232, 248, 148, 139, 208, 95, 208, 49, 177, 88, 76, 139, 90, 4, 52, 127, 200, 102, 60, 219, 89 },
    0,
    { 0 },
    { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
    jamscript_scriptc_service_init,
    1048576,
    16777216
};
