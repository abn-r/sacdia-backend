"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPartialUpdate = buildPartialUpdate;
function buildPartialUpdate(dto, dateFields = []) {
    return Object.fromEntries(Object.entries(dto)
        .filter(([_, value]) => value !== undefined)
        .map(([key, value]) => [
        key,
        dateFields.includes(key) ? new Date(value) : value,
    ]));
}
//# sourceMappingURL=dto.utils.js.map