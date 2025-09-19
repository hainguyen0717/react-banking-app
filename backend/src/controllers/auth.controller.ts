import { LoginRequestDto, LoginResponseDto, validateLoginRequest } from '../dtos/login.dto';
import { HttpError } from '../errors/HttpError';
import { AuthService } from '../services/auth.service';

export class AuthController {
  constructor(private readonly service: AuthService) {}

  async login(body: unknown): Promise<LoginResponseDto> {
    let parsed: LoginRequestDto;
    try {
      parsed = validateLoginRequest(body);
    } catch (error) {
      throw new HttpError(400, (error as Error).message);
    }

    return this.service.validateCredentials(parsed.email, parsed.password);
  }
}
