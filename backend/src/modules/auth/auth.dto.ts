import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class SignUpDto {
  @IsEmail() email!: string;
  @IsString() @Length(6, 200) password!: string;
  @IsString() @Length(6, 200) confirmPassword!: string;
  @IsOptional() @IsString() @Length(1, 100) displayName?: string;
}

export class SignInDto {
  @IsEmail() email!: string;
  @IsString() @Length(1, 200) password!: string;
}

export class RequestPasswordResetDto {
  @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @IsString() @Length(32, 200) token!: string;
  @IsString() @Length(6, 200) password!: string;
  @IsString() @Length(6, 200) confirmPassword!: string;
}
