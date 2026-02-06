export declare class CreateItemDto {
    name: string;
    description?: string;
    inventory_category_id: number;
    amount: number;
    instanceType: 'adv' | 'pathf' | 'mg';
}
