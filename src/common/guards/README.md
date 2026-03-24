# Guards Reference

This directory contains authorization guards for the SACDIA API.

## Available Guards

### 1. JwtAuthGuard
**Purpose**: Authenticate requests using JWT tokens from Supabase

**Usage**:
```typescript
@UseGuards(JwtAuthGuard)
@Get('profile')
getProfile() { ... }
```

**Populates**: `request.user` with `{ sub, userId, user_id, email }`

---

### 2. ClubRolesGuard
**Purpose**: Authorize based on club-specific roles (director, counselor, etc.)

**Usage**:
```typescript
@ClubRoles('director', 'deputy_director')
@UseGuards(JwtAuthGuard, ClubRolesGuard)
@Post('clubs/:clubId/instances')
createInstance() { ... }
```

**Requires**:
- `clubId` in route params, query, or body
- User must have active role assignment in the club

**Roles**:
- director
- deputy_director
- secretary
- treasurer
- counselor
- instructor
- captain
- member

---

### 3. GlobalRolesGuard ⭐ NEW
**Purpose**: Authorize based on global administrative roles

**Usage**:
```typescript
@GlobalRoles('admin', 'super_admin')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@Post('honors/catalog')
createHonor() { ... }
```

**Checks**: `users_roles` table for active global roles

**Roles**:
- super_admin: Full system access
- admin: Local field administration
- coordinator: Union/association level
- user: Regular user (default)

**Operational requirement (admin user management scope)**:
- `super_admin`: scope `ALL` (all users)
- `admin`: scope from actor location. If `union_id` exists => `UNION`; else requires `local_field_id` => `LOCAL_FIELD`
- `coordinator`: requires `local_field_id` => `LOCAL_FIELD`
- If scope data is missing for `admin`/`coordinator`, backend must return `403` (misconfigured role assignment)

---

### 4. OwnerOrAdminGuard ⭐ NEW
**Purpose**: Allow access if user owns the resource OR has admin privileges

**Usage**:
```typescript
@UseGuards(JwtAuthGuard, OwnerOrAdminGuard)
@Get('users/:userId/honors')
getUserHonors(@Param('userId') userId: string) { ... }
```

**Logic**:
1. ✅ Allow if `user.sub === params.userId` (owner)
2. ✅ Allow if user has admin/coordinator/super_admin role
3. ❌ Otherwise deny

**Use Cases**:
- User profile endpoints
- User-specific resources (honors, classes, etc.)
- Personal data access

---

## Guard Combinations

### Public Endpoint
No guards needed:
```typescript
@Get('honors')
findAll() { ... }
```

### Authenticated Only
```typescript
@UseGuards(JwtAuthGuard)
@Get('profile')
getProfile() { ... }
```

### Owner or Admin
```typescript
@UseGuards(JwtAuthGuard, OwnerOrAdminGuard)
@Get('users/:userId/profile')
getUserProfile() { ... }
```

### Admin Only
```typescript
@GlobalRoles('admin', 'super_admin')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
@Delete('users/:userId')
deleteUser() { ... }
```

### Club Role Required
```typescript
@ClubRoles('director', 'deputy_director')
@UseGuards(JwtAuthGuard, ClubRolesGuard)
@Post('clubs/:clubId/activities')
createActivity() { ... }
```

### Multiple Guards (Complex Authorization)
```typescript
// Example: Admin can manage any club, directors can manage their own
@UseGuards(JwtAuthGuard, /* custom logic */)
@Patch('clubs/:clubId/settings')
updateSettings() {
  // Manual check: if not admin, verify user is director of this club
}
```

---

## Request Flow

1. **JwtAuthGuard**: Validates JWT → Sets `request.user`
2. **Authorization Guard**: Checks permissions → Allow/Deny
3. **Controller**: Processes request

---

## Error Responses

### 401 Unauthorized
JwtAuthGuard rejects invalid/missing token

### 403 Forbidden
Authorization guard rejects insufficient permissions:
- `"User not authenticated"`
- `"You need one of these global roles: admin, super_admin"`
- `"You can only access your own resources unless you have admin privileges"`
- `"You need one of these club roles: director, deputy_director"`

---

## Best Practices

1. **Always use JwtAuthGuard first** when combining guards
2. **Apply guards at controller level** for common authorization
3. **Use method-level guards** for specific endpoints
4. **Combine guards** for complex authorization (AND logic)
5. **Use decorators** for role requirements (OR logic)

---

## Testing Guards

```typescript
describe('OwnerOrAdminGuard', () => {
  it('should allow owner access', async () => {
    // user.sub === params.userId
  });

  it('should allow admin access', async () => {
    // user has admin role
  });

  it('should deny non-owner non-admin', async () => {
    // user.sub !== params.userId && !admin
  });
});
```

---

## Common Patterns

### User Resource Protection
```typescript
@Controller('users/:userId')
@UseGuards(JwtAuthGuard, OwnerOrAdminGuard)
export class UserResourceController { ... }
```

### Admin-Only Routes
```typescript
@Controller('admin')
@GlobalRoles('admin', 'super_admin')
@UseGuards(JwtAuthGuard, GlobalRolesGuard)
export class AdminController { ... }
```

### Mixed Authorization
```typescript
@Controller('clubs/:clubId')
@UseGuards(JwtAuthGuard)
export class ClubsController {
  @Get() // Public within auth
  findOne() { ... }

  @ClubRoles('director')
  @UseGuards(ClubRolesGuard)
  @Patch() // Director only
  update() { ... }
}
```
